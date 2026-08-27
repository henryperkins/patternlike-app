import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import {
  ALICE,
  DETERMINISTIC_PATTERN_PUBLISHER,
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  confirmPreferences,
  disablePatternAi,
  enablePatternAi,
  postBirthProfile,
  resetDb,
  seedActiveOntology,
  seedActiveRelease,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import { sha256Hex } from "@patternlike/shared";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import {
  executePatternJob,
  getArtifact,
} from "../services/pattern-execute.js";
import {
  commitPatternTransition,
  loadPatternJob,
} from "../services/pattern-stage-protocol.js";
import {
  recallOntologyAndWithdraw,
  reconcilePatternAfterChartCorrection,
  revokePatternGenerationConsent,
} from "../services/pattern-lifecycle.js";
import { sweepPatternJobs } from "../services/pattern-sweep.js";
import { enqueuePatternGeneration } from "../services/pattern-enqueue.js";
import { hashChartFingerprint } from "../db/pattern-claims.js";
import { loadActiveOntology } from "../db/pattern-ontology.js";
import { insertPatternConsentGrant } from "../db/pattern-consents.js";
import { decryptPayload, rotateUserDek } from "../db/users.js";
import {
  PATTERN_JOB_TYPE,
  type GeneratePatternCommandV1,
} from "../services/pattern-command.js";
import { assembleAccountExport } from "../services/account-export.js";
import {
  computeOntologyBundleHash,
  parseOntologyKeys,
  verifyOntologySignature,
  ontologySigningPayload,
} from "../services/pattern-ontology-verify.js";
import { generateSigningKey, releaseKeysVar, toBase64Url } from "../../test/content-release-fixtures.js";
import {
  clearPatternReplayObjects,
  generatePatternReplayTestKeys,
  installPatternReplayTestKeys,
} from "../../test/pattern-replay-fixtures.js";

const POLICY = "1.1.0";

async function jsonAs(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await SELF.fetch(`http://api.test${path}`, {
    ...init,
    headers: {
      "x-user-id": userId,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function json(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return jsonAs(USER_A, path, init);
}

async function drain(generationId: string): Promise<string> {
  for (let step = 0; step < 8; step++) {
    const row = await env.DB.prepare(
      `SELECT job_id, generation_id, stage, stage_generation
       FROM pattern_generation_jobs WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ job_id: string; generation_id: string; stage: string; stage_generation: number }>();
    if (!row) throw new Error("pattern job missing");
    if (row.stage === "succeeded" || row.stage === "failed" || row.stage === "cancelled") {
      return row.stage;
    }
    await executePatternJob(env, {
      kind: "pattern_generation",
      job_id: row.job_id,
      generation_id: row.generation_id,
      stage_generation: row.stage_generation,
    }, new Date(), DETERMINISTIC_PATTERN_PUBLISHER);
  }
  throw new Error("pattern generation did not finish");
}

describe("M7 AI-generated Pattern", () => {
  beforeEach(async () => {
    await resetDb();
    await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
    installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
    disablePatternAi();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
  });

  afterEach(() => {
    disablePatternAi();
    env.PATTERN_ONTOLOGY_KEYS = "";
  });

  it("admits every authenticated account to the generated flow, never the catalogue", async () => {
    // No ontology is active in this fixture, so the generated flow reports the
    // ontology gate. What it must never report is an account-admission outcome.
    const state = await json("/v1/pattern-state");
    expect(state.status).toBe(200);
    expect(state.body.state).not.toBe("editorial_catalog");
    expect(state.body.state).toBe("ontology_unavailable");
  });

  it("gives two identically eligible accounts the same generated state", async () => {
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_B);
    await seedChart(IDENTITY_B);
    // An active editorial release is preserved data, not an admission decision.
    await seedActiveRelease();
    await seedActiveOntology();
    enablePatternAi();

    const alice = await json("/v1/pattern-state");
    const bob = await jsonAs(USER_B, "/v1/pattern-state");
    expect(alice.body.state, JSON.stringify(alice.body)).toBe("consent_required");
    expect(bob.body.state, JSON.stringify(bob.body)).toBe("consent_required");
  });

  it("answers GET /v1/pattern on the generated contract even with an editorial release", async () => {
    await seedActiveRelease();
    await seedActiveOntology();
    enablePatternAi();

    // The generated reader rejects every query parameter; the M4 catalogue
    // accepted `limit`. The code is what proves which contract answered.
    const response = await json("/v1/pattern?limit=5");
    expect(response.status).toBe(400);
    expect((response.body.error as { code?: string }).code).toBe("invalid_pattern_query");

    const bare = await json("/v1/pattern");
    expect(bare.status).toBe(409);
    expect((bare.body.error as { code?: string }).code)
      .toBe("pattern_generation_consent_required");
  });

  it("grants consent and publishes one Pattern without falling back to M4", async () => {
    enablePatternAi();
    await seedActiveOntology();

    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-first-open-1" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(reserved.status, JSON.stringify(reserved.body)).toBe(202);
    const generation = reserved.body.generation as { generation_id: string };
    expect(generation.generation_id).toMatch(/^pgen_/);

    const consent = await env.DB.prepare(
      `SELECT kind, status FROM consents WHERE user_id = ? AND kind = 'pattern_generation'`,
    )
      .bind(USER_A)
      .first<{ kind: string; status: string }>();
    expect(consent).toEqual({ kind: "pattern_generation", status: "granted" });

    expect(await drain(generation.generation_id)).toBe("succeeded");

    const ready = await json("/v1/pattern-state");
    expect(ready.body.state).toBe("ready");

    const pattern = await json("/v1/pattern");
    expect(pattern.status).toBe(200);
    expect(pattern.body.schema_version).toBe("0.7.0");
    expect(pattern.body.core_chapters).toEqual(expect.any(Array));
    expect(JSON.stringify(pattern.body)).not.toMatch(/nft_/);
    expect(JSON.stringify(pattern.body)).not.toContain("feature_aliases");
    expect(JSON.stringify(pattern.body)).not.toContain("Why this");

    const withCursor = await json("/v1/pattern?cursor=abc");
    expect(withCursor.status).toBe(400);
    expect(withCursor.body.error).toEqual(
      expect.objectContaining({ code: "invalid_pattern_query" }),
    );
  });

  it("freezes the approved three-attempt writer ceiling in a new command", async () => {
    enablePatternAi();
    await seedActiveOntology();

    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-writer-attempt-ceiling" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(reserved.status, JSON.stringify(reserved.body)).toBe(202);
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    const row = await env.DB.prepare(
      `SELECT j.id AS job_id, j.payload_enc, j.payload_key_version, j.payload_nonce
       FROM jobs j
       JOIN pattern_generation_jobs p ON p.job_id = j.id
       WHERE p.generation_id = ?`,
    )
      .bind(generationId)
      .first<{
        job_id: string;
        payload_enc: ArrayBuffer;
        payload_key_version: number;
        payload_nonce: string;
      }>();
    expect(row).not.toBeNull();
    let binary = "";
    for (const byte of new Uint8Array(row!.payload_enc)) binary += String.fromCharCode(byte);
    const command = await decryptPayload<GeneratePatternCommandV1>(
      env,
      IDENTITY_A,
      {
        key_version: row!.payload_key_version,
        nonce: row!.payload_nonce,
        ciphertext: btoa(binary),
      },
      {
        subject: IDENTITY_A.cryptoSubject,
        field: "jobs.payload_enc",
        recordId: row!.job_id,
      },
    );

    expect(command.planner_attempts_max).toBe(2);
    expect(command.writer_attempts_max).toBe(3);
    expect(command.verifier_attempts_max).toBe(2);
  });

  it("does not consume the claim when generation is cancelled, and delete blocks regeneration", async () => {
    enablePatternAi();
    await seedActiveOntology();

    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-cancel-1" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(reserved.status).toBe(202);
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;

    await recallOntologyAndWithdraw(env, "ont-test-1", "test_recall");
    expect(await drain(generationId)).toBe("cancelled");

    const claim = await env.DB.prepare(
      `SELECT status, consumed_at FROM pattern_generation_claims WHERE user_id = ?`,
    )
      .bind(USER_A)
      .first<{ status: string; consumed_at: string | null }>();
    expect(claim?.status).toBe("available");
    expect(claim?.consumed_at).toBeNull();

    await seedActiveOntology("ont-test-2");
    const retry = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-retry-after-cancel" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(retry.status, JSON.stringify(retry.body)).toBe(202);
    expect(await drain((retry.body.generation as { generation_id: string }).generation_id)).toBe(
      "succeeded",
    );

    const erased = await json("/v1/pattern", {
      method: "DELETE",
      headers: { "idempotency-key": "idem-pattern-delete-1" },
      body: JSON.stringify({ confirm: "DELETE PATTERN" }),
    });
    expect(erased.status).toBe(202);

    const gone = await json("/v1/pattern");
    expect(gone.status).toBe(410);
    expect((gone.body.error as { code: string }).code).toBe("pattern_deleted");

    const blocked = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-after-delete" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(blocked.status).toBe(409);
    expect((blocked.body.error as { code: string }).code).toBe("pattern_already_consumed");
  });

  it("does not serve M4 evidence on the first-open AI path before a claim exists", async () => {
    enablePatternAi();
    const pattern = await json("/v1/pattern");
    expect(pattern.status).toBe(409);
    expect((pattern.body.error as { code: string }).code).toBe("pattern_generation_consent_required");
    expect(pattern.body).not.toHaveProperty("items");
  });

  it("binds GET /v1/pattern to the active chart fingerprint", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-fingerprint-bind" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(reserved.status).toBe(202);
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    expect(await drain(generationId)).toBe("succeeded");
    const ready = await json("/v1/pattern");
    expect(ready.status).toBe(200);
    expect(ready.body.schema_version).toBe("0.7.0");

    await env.DB.prepare(
      `UPDATE chart_snapshots SET fingerprint = ? WHERE user_id = ? AND status = 'active'`,
    )
      .bind(`sha256:${"2b".repeat(32)}`, USER_A)
      .run();

    const afterCorrection = await json("/v1/pattern");
    expect(afterCorrection.status).not.toBe(200);
    expect((afterCorrection.body.error as { code: string }).code).not.toBe("pattern_deleted");
    expect(afterCorrection.body.schema_version).not.toBe("0.7.0");
  });

  it("does not 410 a new chart from a deleted claim on another fingerprint", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-deleted-other-fp" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(await drain((reserved.body.generation as { generation_id: string }).generation_id)).toBe(
      "succeeded",
    );
    const erased = await json("/v1/pattern", {
      method: "DELETE",
      headers: { "idempotency-key": "idem-pattern-delete-other-fp" },
      body: JSON.stringify({ confirm: "DELETE PATTERN" }),
    });
    expect(erased.status).toBe(202);
    expect((await json("/v1/pattern")).status).toBe(410);

    await env.DB.prepare(
      `UPDATE chart_snapshots SET fingerprint = ? WHERE user_id = ? AND status = 'active'`,
    )
      .bind(`sha256:${"3c".repeat(32)}`, USER_A)
      .run();

    const nextChart = await json("/v1/pattern");
    expect(nextChart.status).toBe(404);
    expect((nextChart.body.error as { code: string }).code).toBe("pattern_not_generated");
    const nextState = await json("/v1/pattern-state");
    expect(nextState.body.state).toBe("available");
  });

  it("refuses to sign a release that is not synthetic_internal", async () => {
    const release = {
      ...syntheticOntologyRelease("ont-sign-machine"),
      provenance: { origin: "machine_pipeline" as const },
    };
    const response = await SELF.fetch(
      "http://api.test/internal/pattern-ontology-releases/sign",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(release),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ontology_origin_not_synthetic_internal");
  });

  it("signs an authored synthetic release into an ingestible bundle", async () => {
    env.PATTERN_ONTOLOGY_KEYS = JSON.stringify({
      [env.TEST_ONTOLOGY_SIGNER_KEY_ID]: {
        alg: "Ed25519",
        public_key: env.TEST_ONTOLOGY_SIGNER_PUBLIC_KEY,
      },
    });
    const release = {
      ...syntheticOntologyRelease("ont-sign-internal"),
      // The signer refuses a non-candidate payload; activation is ingestion's job.
      status: "candidate" as const,
      provenance: { origin: "synthetic_internal" as const },
    };
    const response = await SELF.fetch(
      "http://api.test/internal/pattern-ontology-releases/sign",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(release),
      },
    );
    expect(response.status).toBe(200);
    const signed = (await response.json()) as {
      bundle_hash: string;
      signature: { key_id: string; signed_payload_hash: string };
    };
    // The route recomputes the hash rather than trusting the caller, and the
    // signer signs over exactly that.
    expect(signed.signature.key_id).toBe(env.TEST_ONTOLOGY_SIGNER_KEY_ID);
    expect(signed.signature.signed_payload_hash).toBe(signed.bundle_hash);
    expect(
      await verifyOntologySignature(
        signed as never,
        parseOntologyKeys(env.PATTERN_ONTOLOGY_KEYS),
      ),
    ).toBeNull();
    env.PATTERN_ONTOLOGY_KEYS = "";
  });

  it("refuses unsigned ontology ingest when signing keys are configured", async () => {
    const key = await generateSigningKey("ont-test");
    env.PATTERN_ONTOLOGY_KEYS = releaseKeysVar([key]);
    const release = syntheticOntologyRelease("ont-unsigned");
    const hash = await computeOntologyBundleHash(release);
    const response = await SELF.fetch("http://api.test/internal/pattern-ontology-releases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...release, bundle_hash: hash }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ontology_signature_invalid");
    env.PATTERN_ONTOLOGY_KEYS = "";
  });

  it("does not execute against tampered ontology bytes", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-ontology-tamper" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const object = await env.ARTIFACTS!.get("pattern-ontology/ont-test-1.json");
    expect(object).not.toBeNull();
    const parsed = JSON.parse(await object!.text()) as { locale: string };
    parsed.locale = "en-GB";
    await env.ARTIFACTS!.put("pattern-ontology/ont-test-1.json", JSON.stringify(parsed));
    expect(await loadActiveOntology(env)).toBeNull();
    expect(await drain((reserved.body.generation as { generation_id: string }).generation_id)).toBe(
      "cancelled",
    );
  });

  it("does not revive a recalled ontology version", async () => {
    await seedActiveOntology();
    await recallOntologyAndWithdraw(env, "ont-test-1", "test_recall");
    const release = syntheticOntologyRelease("ont-test-1");
    const hash = await computeOntologyBundleHash(release);
    const response = await SELF.fetch("http://api.test/internal/pattern-ontology-releases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...release, bundle_hash: hash }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ontology_version_recalled");
    const pointer = await env.DB.prepare(
      `SELECT active_version FROM pattern_ontology_pointer WHERE id = 1`,
    ).first<{ active_version: string | null }>();
    expect(pointer?.active_version).toBeNull();
    const row = await env.DB.prepare(
      `SELECT status FROM pattern_ontology_releases WHERE version = ?`,
    )
      .bind("ont-test-1")
      .first<{ status: string }>();
    expect(row?.status).toBe("recalled");
  });

  it("ignores a stale failure transition after another worker published", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-stale-fail" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    expect(await drain(generationId)).toBe("succeeded");
    const job = await loadPatternJob(env, generationId);
    expect(job).not.toBeNull();
    expect(await commitPatternTransition(env, job!, "clm_stale_token_does_not_own", {
      kind: "fail",
      failureClass: "stale_worker",
      publicStage: "checking_claims",
    })).toBeNull();
    const claim = await env.DB.prepare(
      `SELECT status FROM pattern_generation_claims WHERE user_id = ?`,
    )
      .bind(USER_A)
      .first<{ status: string }>();
    expect(claim?.status).toBe("accepted");
    const domain = await env.DB.prepare(
      `SELECT stage FROM pattern_generation_jobs WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ stage: string }>();
    expect(domain?.stage).toBe("succeeded");
    expect((await json("/v1/pattern")).status).toBe(200);
  });

  it("erases artifact keys, command ciphertext, and R2 objects on critical recall", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-recall-erase" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    expect(await drain(generationId)).toBe("succeeded");
    expect(await recallOntologyAndWithdraw(env, "ont-test-1", "critical_defect")).toBe(1);
    const key = await env.DB.prepare(
      `SELECT wrapped_key_enc, erased_at FROM pattern_generation_artifact_keys WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ wrapped_key_enc: ArrayBuffer | null; erased_at: string | null }>();
    expect(key?.wrapped_key_enc).toBeNull();
    expect(key?.erased_at).toBeTruthy();
    const payload = await env.DB.prepare(
      `SELECT payload_enc FROM jobs WHERE id = (SELECT job_id FROM pattern_generation_jobs WHERE generation_id = ?)`,
    )
      .bind(generationId)
      .first<{ payload_enc: ArrayBuffer | null }>();
    expect(payload?.payload_enc).toBeNull();
    const leftover = await env.ARTIFACTS!.list({ prefix: `pattern-generations/${generationId}/` });
    expect(leftover.objects).toEqual([]);
    expect((await json("/v1/pattern")).status).toBe(410);
  });

  it("marks only actually deleted artifact rows during sweep", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-sweep-leftover" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    expect(await drain(generationId)).toBe("succeeded");
    const expired = new Date(Date.now() - 60_000).toISOString();
    for (let index = 0; index < 101; index++) {
      await env.DB.prepare(
        `INSERT INTO pattern_generation_artifacts (
           id, generation_id, user_id, artifact_class, object_key, ciphertext_sha256,
           plaintext_sha256, byte_length, created_at, expires_at, deleted_at
         ) VALUES (?, ?, ?, 'fact_packet', ?, ?, ?, 1, ?, ?, NULL)`,
      )
        .bind(
          `sweep_${String(index).padStart(3, "0")}`,
          generationId,
          USER_A,
          `pattern-generations/${generationId}/sweep-${index}.json.enc`,
          `sha256:${"ab".repeat(32)}`,
          `sha256:${"cd".repeat(32)}`,
          expired,
          expired,
        )
        .run();
    }
    await sweepPatternJobs(env);
    const leftover = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_generation_artifacts
       WHERE generation_id = ? AND object_key LIKE '%/sweep-%' AND deleted_at IS NULL`,
    )
      .bind(generationId)
      .first<{ n: number }>();
    expect(leftover?.n).toBe(1);
    const marked = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_generation_artifacts
       WHERE generation_id = ? AND object_key LIKE '%/sweep-%' AND deleted_at IS NOT NULL`,
    )
      .bind(generationId)
      .first<{ n: number }>();
    expect(marked?.n).toBe(100);
  });

  it("keeps an eleven-call job recoverable beneath the stage-claim ceiling", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-eleven-call-claim-ceiling" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(reserved.status, JSON.stringify(reserved.body)).toBe(202);
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    const job = await env.DB.prepare(
      `SELECT job_id FROM pattern_generation_jobs WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ job_id: string }>();
    const now = new Date("2026-08-20T12:00:00Z");
    await env.DB.prepare(
      `UPDATE jobs
       SET status = 'running', attempts = 11, claim_token = 'clm_expired_worst_case',
           lease_expires_at = ?, result_class = NULL
       WHERE id = ?`,
    )
      .bind(new Date(now.getTime() - 60_000).toISOString(), job!.job_id)
      .run();

    await sweepPatternJobs(env, now);

    const after = await env.DB.prepare(
      `SELECT j.status, j.result_class, p.stage, p.failure_class
       FROM jobs j
       JOIN pattern_generation_jobs p ON p.job_id = j.id
       WHERE p.generation_id = ?`,
    )
      .bind(generationId)
      .first<{
        status: string;
        result_class: string | null;
        stage: string;
        failure_class: string | null;
      }>();
    expect(after).toEqual({
      status: "running",
      result_class: null,
      stage: "reserved",
      failure_class: null,
    });
  });

  it("fails an exhausted expired lease through the stage protocol", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-exhausted-expired-lease" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(reserved.status, JSON.stringify(reserved.body)).toBe(202);
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    const before = await loadPatternJob(env, generationId);
    expect(before).not.toBeNull();
    const now = new Date("2026-08-20T12:00:00.000Z");
    await env.DB.prepare(
      `UPDATE jobs
       SET status = 'running', attempts = 16, claim_token = 'clm_expired_exhausted',
           lease_expires_at = ?, result_class = NULL
       WHERE id = ?`,
    )
      .bind(new Date(now.getTime() - 60_000).toISOString(), before!.job_id)
      .run();

    await sweepPatternJobs(env, now);

    const after = await env.DB.prepare(
      `SELECT j.status AS job_status, j.result_class,
              p.stage, p.stage_generation,
              p.planner_attempts, p.writer_attempts, p.verifier_attempts,
              p.plan_hash, p.candidate_hash, p.semantic_verdict_hash,
              p.public_failure_stage, p.failure_class, p.retention_expires_at,
              c.status AS claim_status
       FROM pattern_generation_jobs p
       JOIN jobs j ON j.id = p.job_id
       JOIN pattern_generation_claims c ON c.id = p.claim_id
       WHERE p.generation_id = ?`,
    )
      .bind(generationId)
      .first<{
        job_status: string;
        result_class: string | null;
        stage: string;
        stage_generation: number;
        planner_attempts: number;
        writer_attempts: number;
        verifier_attempts: number;
        plan_hash: string | null;
        candidate_hash: string | null;
        semantic_verdict_hash: string | null;
        public_failure_stage: string | null;
        failure_class: string | null;
        retention_expires_at: string | null;
        claim_status: string;
      }>();
    expect(after).toEqual({
      job_status: "failed",
      result_class: "stage_attempts_exhausted",
      stage: "failed",
      stage_generation: before!.stage_generation + 1,
      planner_attempts: before!.planner_attempts,
      writer_attempts: before!.writer_attempts,
      verifier_attempts: before!.verifier_attempts,
      plan_hash: before!.plan_hash,
      candidate_hash: before!.candidate_hash,
      semantic_verdict_hash: before!.semantic_verdict_hash,
      public_failure_stage: "organizing_evidence",
      failure_class: "stage_attempts_exhausted",
      retention_expires_at: "2026-09-19T12:00:00.000Z",
      claim_status: "available",
    });
  });

  it("repairs an exhausted expired lease whose domain stage is already terminal", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-exhausted-torn-row" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(reserved.status, JSON.stringify(reserved.body)).toBe(202);
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    const before = await loadPatternJob(env, generationId);
    expect(before).not.toBeNull();
    const now = new Date("2026-08-20T12:00:00.000Z");

    // The torn state this sweep produces itself: a worker stole the lease
    // between the SELECT and the batch, so the domain row committed `failed`
    // while the jobs row stayed `running`. The expired-lease selector does not
    // filter on p.stage, so the row comes back every tick until something
    // repairs the jobs row -- and planPatternTransition refuses a terminal
    // input, so only the domain statement may drop out.
    await env.DB.prepare(
      `UPDATE pattern_generation_jobs SET stage = 'failed' WHERE generation_id = ?`,
    )
      .bind(generationId)
      .run();
    await env.DB.prepare(
      `UPDATE jobs
       SET status = 'running', attempts = 16, claim_token = 'clm_expired_torn',
           lease_expires_at = ?, result_class = NULL
       WHERE id = ?`,
    )
      .bind(new Date(now.getTime() - 60_000).toISOString(), before!.job_id)
      .run();

    await sweepPatternJobs(env, now);

    const after = await env.DB.prepare(
      `SELECT j.status AS job_status, j.result_class, j.claim_token, j.lease_expires_at,
              p.stage, p.stage_generation, c.status AS claim_status
       FROM pattern_generation_jobs p
       JOIN jobs j ON j.id = p.job_id
       JOIN pattern_generation_claims c ON c.id = p.claim_id
       WHERE p.generation_id = ?`,
    )
      .bind(generationId)
      .first<{
        job_status: string;
        result_class: string | null;
        claim_token: string | null;
        lease_expires_at: string | null;
        stage: string;
        stage_generation: number;
        claim_status: string;
      }>();
    expect(after).toEqual({
      job_status: "failed",
      result_class: "stage_attempts_exhausted",
      claim_token: null,
      lease_expires_at: null,
      // Already terminal, so the domain row is left exactly as it was found.
      stage: "failed",
      stage_generation: before!.stage_generation,
      claim_status: "available",
    });

    // Repaired for good: a second tick no longer sees the row at all.
    await sweepPatternJobs(env, new Date(now.getTime() + 60_000));
    const stillFailed = await env.DB.prepare(
      `SELECT status FROM jobs WHERE id = ?`,
    )
      .bind(before!.job_id)
      .first<{ status: string }>();
    expect(stillFailed?.status).toBe("failed");
  });

  it("refuses publication when semantic verification rejects", async () => {
    enablePatternAi();
    env.PATTERN_SEMANTIC_FORCE_REJECT = "1";
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-semantic-reject" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    expect(await drain(generationId)).toBe("failed");
    const documents = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_documents WHERE user_id = ?`,
    )
      .bind(USER_A)
      .first<{ n: number }>();
    expect(documents?.n).toBe(0);
    const pattern = await json("/v1/pattern");
    expect(pattern.status).not.toBe(200);
  });

  it("replays an idempotent POST with the real public stage", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const body = {
      schema_version: "0.7.0",
      consent_policy_version: POLICY,
      confirm: "GENERATE MY PATTERN",
      reason: "first_open",
    };
    const first = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-replay-stage" },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(202);
    const generationId = (first.body.generation as { generation_id: string }).generation_id;
    expect(await drain(generationId)).toBe("succeeded");
    const replay = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-replay-stage" },
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    expect((replay.body.generation as { stage: string }).stage).toBe("ready");
  });

  it("cancels the domain job on revoke so GET status is not writing", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-revoke-cancel" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    await revokePatternGenerationConsent(env, IDENTITY_A);
    const status = await json(`/v1/pattern-generations/${generationId}`);
    expect(status.status).toBe(404);
    const domain = await env.DB.prepare(
      `SELECT stage FROM pattern_generation_jobs WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ stage: string }>();
    expect(domain?.stage).toBe("cancelled");
  });

  it("accepts a first generation from an account that was never allowlisted", async () => {
    enablePatternAi();
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_B);
    await seedChart(IDENTITY_B);
    await seedActiveOntology();
    const reserved = await jsonAs(USER_B, "/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-not-allowlisted" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(reserved.status, JSON.stringify(reserved.body)).toBe(202);
  });

  it("serves a public release to any account and an internal release to none", async () => {
    enablePatternAi();
    await seedUser(IDENTITY_B);
    await confirmPreferences(USER_B);
    await seedChart(IDENTITY_B);

    // The release that used to serve the allowlist. It now serves nobody:
    // activation scope is a content-integrity invariant, and there is no
    // account it can be opened for.
    await seedActiveOntology("ont-internal-only", { activationScope: "internal" });
    for (const userId of [USER_A, USER_B]) {
      const denied = await jsonAs(userId, "/v1/pattern-generations", {
        method: "POST",
        headers: { "idempotency-key": `idem-internal-denied-${userId}` },
        body: JSON.stringify({
          schema_version: "0.7.0",
          consent_policy_version: POLICY,
          confirm: "GENERATE MY PATTERN",
          reason: "first_open",
        }),
      });
      expect(denied.status, `${userId}: ${JSON.stringify(denied.body)}`).toBe(409);
      expect((denied.body.error as { code: string }).code).toBe("ontology_unavailable");
      const state = await jsonAs(userId, "/v1/pattern-state");
      expect(state.body.state).toBe("ontology_unavailable");
    }
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM pattern_generation_claims",
    ).first<{ n: number }>()).toEqual({ n: 0 });

    // A public machine release serves the account that was never allowlisted.
    await seedActiveOntology("ont-public-1");
    const accepted = await jsonAs(USER_B, "/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-public-accepted" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(202);
  });

  it("refuses generation for an eligible account only on the eligibility ladder", async () => {
    enablePatternAi();
    // No active ontology: the refusal is a content-integrity invariant that
    // applies to every account, not an admission decision about this one.
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-ontology-gate" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(reserved.status).toBe(409);
    expect((reserved.body.error as { code: string }).code).toBe("ontology_unavailable");
  });

  it("refuses chart-correction auto-reserve without a prior grant", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const result = await enqueuePatternGeneration(env, IDENTITY_A, {
      idempotencyKey: "idem-pattern-correction-no-grant",
      consentPolicyVersion: POLICY,
      reason: "chart_correction",
      requestId: "chart_correction",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("pattern_generation_consent_required");
    }
  });

  it("nudges a stuck generation from the internal reconcile route", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-reconcile" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    const jobId = (await env.DB.prepare(
      `SELECT job_id FROM pattern_generation_jobs WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ job_id: string }>())!.job_id;
    await env.DB.prepare(`UPDATE jobs SET dispatched_at = NULL WHERE id = ?`).bind(jobId).run();
    const response = await SELF.fetch(
      `http://api.test/internal/pattern-generations/${generationId}/reconcile`,
      { method: "POST" },
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { status: string; generation_id: string };
    expect(body.generation_id).toBe(generationId);
    expect(body.status).toBe("accepted");
    const job = await env.DB.prepare(`SELECT dispatched_at FROM jobs WHERE id = ?`)
      .bind(jobId)
      .first<{ dispatched_at: string | null }>();
    expect(job?.dispatched_at).toBeTruthy();
  });

  it("audits admin reads and records not_found instead of granted on 404", async () => {
    const missing = "pgen_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const response = await SELF.fetch(`http://api.test/admin/pattern-generations/${missing}`);
    expect(response.status).toBe(404);
    const event = await env.DB.prepare(
      `SELECT result, target_scope_hash FROM pattern_admin_access_events WHERE generation_id = ?`,
    )
      .bind(missing)
      .first<{ result: string; target_scope_hash: string }>();
    expect(event?.result).toBe("not_found");
    expect(event?.target_scope_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(event?.target_scope_hash).not.toBe(missing);
  });

  it("clears the frozen Pattern command on chart correction", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-correction-payload" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    expect(await drain(generationId)).toBe("succeeded");
    await reconcilePatternAfterChartCorrection(
      env,
      IDENTITY_A,
      "cht_correction_payload_test",
    );
    const payload = await env.DB.prepare(
      `SELECT payload_enc FROM jobs WHERE id = (SELECT job_id FROM pattern_generation_jobs WHERE generation_id = ?)`,
    )
      .bind(generationId)
      .first<{ payload_enc: ArrayBuffer | null }>();
    expect(payload?.payload_enc).toBeNull();
  });

  it("names artifacts by class and stage generation so rejected drafts do not collide", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-artifact-id" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    expect(await drain(generationId)).toBe("succeeded");
    // Four components since Task 6: the attempt index joins the identity, so a
    // genuine retry writes a fresh artifact instead of colliding with the one
    // before it and being silently discarded.
    const digest = await sha256Hex(`${generationId}:fact_packet:0:0`);
    const row = await env.DB.prepare(
      `SELECT id FROM pattern_generation_artifacts
       WHERE generation_id = ? AND artifact_class = 'fact_packet'`,
    )
      .bind(generationId)
      .first<{ id: string }>();
    expect(row?.id).toBe(`part_${digest.slice(0, 32)}`);
  });

  it("accepts a signed ontology release when keys are configured", async () => {
    const key = await generateSigningKey("ont-sign");
    env.PATTERN_ONTOLOGY_KEYS = releaseKeysVar([key]);
    const release = syntheticOntologyRelease("ont-signed-1");
    const hash = await computeOntologyBundleHash(release);
    const payload = ontologySigningPayload({ ...release, bundle_hash: hash });
    const signature = await crypto.subtle.sign(
      { name: key.privateKey.algorithm.name },
      key.privateKey,
      new TextEncoder().encode(payload),
    );
    const response = await SELF.fetch("http://api.test/internal/pattern-ontology-releases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...release,
        bundle_hash: hash,
        signature: {
          alg: key.alg,
          key_id: key.keyId,
          signature: toBase64Url(new Uint8Array(signature)),
          signed_payload_hash: hash,
        },
      }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await loadActiveOntology(env)).not.toBeNull();
  });

  it("pins concurrent reservations and ignores a stale cancel of the loser", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const nowIso = new Date().toISOString();
    const fingerprintHash = await hashChartFingerprint(`sha256:${"1a".repeat(32)}`);
    await env.DB.prepare(
      `INSERT INTO pattern_generation_claims (
         id, user_id, chart_fingerprint_hash, last_chart_id, status,
         active_generation_id, consumed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'available', NULL, NULL, ?, ?)`,
    )
      .bind("pgc_available_race", USER_A, fingerprintHash, `cht_seed_${USER_A.slice(-8)}`, nowIso, nowIso)
      .run();
    const [first, second] = await Promise.all([
      enqueuePatternGeneration(env, IDENTITY_A, {
        idempotencyKey: "idem-pattern-concurrent-a",
        consentPolicyVersion: POLICY,
        reason: "first_open",
        requestId: "concurrent-a",
      }),
      enqueuePatternGeneration(env, IDENTITY_A, {
        idempotencyKey: "idem-pattern-concurrent-b",
        consentPolicyVersion: POLICY,
        reason: "first_open",
        requestId: "concurrent-b",
      }),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.body.generation.generation_id).toBe(second.body.generation.generation_id);
    const jobs = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND job_type = ?`,
    )
      .bind(USER_A, PATTERN_JOB_TYPE)
      .first<{ n: number }>();
    expect(jobs?.n).toBe(1);
    const winnerId = first.body.generation.generation_id;
    const winner = await loadPatternJob(env, winnerId);
    expect(winner).not.toBeNull();
    await env.DB.prepare(
      `UPDATE jobs SET status = 'running', claim_token = ? WHERE id = ?`,
    )
      .bind("clm_stale_loser", winner!.job_id)
      .run();
    await env.DB.prepare(
      `UPDATE pattern_generation_claims
       SET status = 'reserved', active_generation_id = ?
       WHERE user_id = ?`,
    )
      .bind("pgen_winner_other_generation", USER_A)
      .run();
    expect(await commitPatternTransition(env, winner!, "clm_stale_loser", {
      kind: "fail",
      failureClass: "stale_loser",
      publicStage: "organizing_evidence",
    })).not.toBeNull();
    const afterFail = await env.DB.prepare(
      `SELECT status, active_generation_id FROM pattern_generation_claims WHERE user_id = ?`,
    )
      .bind(USER_A)
      .first<{ status: string; active_generation_id: string | null }>();
    expect(afterFail).toEqual({
      status: "reserved",
      active_generation_id: "pgen_winner_other_generation",
    });

    await env.DB.prepare(
      `UPDATE pattern_generation_claims
       SET status = 'available', active_generation_id = NULL
       WHERE user_id = ?`,
    )
      .bind(USER_A)
      .run();
    const retry = await enqueuePatternGeneration(env, IDENTITY_A, {
      idempotencyKey: "idem-pattern-concurrent-cancel",
      consentPolicyVersion: POLICY,
      reason: "first_open",
      requestId: "concurrent-cancel",
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    const cancelTarget = await loadPatternJob(env, retry.body.generation.generation_id);
    expect(cancelTarget).not.toBeNull();
    await env.DB.prepare(
      `UPDATE jobs SET status = 'running', claim_token = ? WHERE id = ?`,
    )
      .bind("clm_stale_cancel", cancelTarget!.job_id)
      .run();
    await env.DB.prepare(
      `UPDATE pattern_generation_claims
       SET status = 'reserved', active_generation_id = ?
       WHERE user_id = ?`,
    )
      .bind("pgen_winner_after_retry", USER_A)
      .run();
    expect(await commitPatternTransition(env, cancelTarget!, "clm_stale_cancel", {
      kind: "cancel",
      reason: "cancel_stale",
    })).not.toBeNull();
    const afterCancel = await env.DB.prepare(
      `SELECT status, active_generation_id FROM pattern_generation_claims WHERE user_id = ?`,
    )
      .bind(USER_A)
      .first<{ status: string; active_generation_id: string | null }>();
    expect(afterCancel).toEqual({
      status: "reserved",
      active_generation_id: "pgen_winner_after_retry",
    });
  });

  it("finishes erasure when critical recall is retried after the version is already recalled", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-recall-retry" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    expect(await drain(generationId)).toBe("succeeded");
    await env.DB.prepare(
      `UPDATE pattern_ontology_releases SET status = 'recalled', recalled_at = ? WHERE version = ?`,
    )
      .bind(new Date().toISOString(), "ont-test-1")
      .run();
    await env.DB.prepare(`UPDATE pattern_ontology_pointer SET active_version = NULL WHERE id = 1`).run();
    const leftoverDoc = await env.DB.prepare(
      `SELECT id FROM pattern_documents WHERE user_id = ?`,
    )
      .bind(USER_A)
      .first<{ id: string }>();
    expect(leftoverDoc).not.toBeNull();
    const leftoverKey = await env.DB.prepare(
      `SELECT wrapped_key_enc FROM pattern_generation_artifact_keys WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ wrapped_key_enc: ArrayBuffer | null }>();
    expect(leftoverKey?.wrapped_key_enc).not.toBeNull();
    const blocked = await json("/v1/pattern");
    expect(blocked.status).toBe(410);
    expect((blocked.body.error as { code: string }).code).toBe("pattern_withdrawn");

    const response = await SELF.fetch(
      "http://api.test/internal/pattern-ontology-releases/ont-test-1/recall",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { withdrawn_patterns: number };
    expect(body.withdrawn_patterns).toBe(1);
    const key = await env.DB.prepare(
      `SELECT wrapped_key_enc, erased_at FROM pattern_generation_artifact_keys WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ wrapped_key_enc: ArrayBuffer | null; erased_at: string | null }>();
    expect(key?.wrapped_key_enc).toBeNull();
    expect(key?.erased_at).toBeTruthy();
    const document = await env.DB.prepare(
      `SELECT id FROM pattern_documents WHERE user_id = ?`,
    )
      .bind(USER_A)
      .first<{ id: string }>();
    expect(document).toBeNull();
    const leftover = await env.ARTIFACTS!.list({ prefix: `pattern-generations/${generationId}/` });
    expect(leftover.objects).toEqual([]);
    expect((await json("/v1/pattern")).status).toBe(410);
  });

  it("maps leftover GET /v1/pattern statuses the same way as pattern-state", async () => {
    enablePatternAi();
    await seedActiveOntology();
    await env.DB.batch([
      insertPatternConsentGrant(env, USER_A, "cns_pattern_grant_only", 1, null, new Date().toISOString()),
    ]);
    const available = await json("/v1/pattern");
    expect(available.status).toBe(404);
    expect((available.body.error as { code: string }).code).toBe("pattern_not_generated");
    const availableState = await json("/v1/pattern-state");
    expect(availableState.body.state).toBe("available");

    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-leftover-status" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(await drain((reserved.body.generation as { generation_id: string }).generation_id)).toBe(
      "succeeded",
    );
    await env.DB.prepare(`DELETE FROM pattern_documents WHERE user_id = ?`).bind(USER_A).run();
    const acceptedWithoutDoc = await json("/v1/pattern");
    expect(acceptedWithoutDoc.status).toBe(404);
    expect((acceptedWithoutDoc.body.error as { code: string }).code).toBe("pattern_not_generated");
    await env.DB.prepare(
      `UPDATE pattern_generation_claims SET status = 'superseded' WHERE user_id = ?`,
    )
      .bind(USER_A)
      .run();
    const superseded = await json("/v1/pattern");
    expect(superseded.status).toBe(410);
    expect((superseded.body.error as { code: string }).code).toBe("pattern_deleted");
    const supersededState = await json("/v1/pattern-state");
    expect(supersededState.body.state).toBe("deleted");
  });

  it("decrypts Pattern artifacts after user DEK rotation", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-dek-rotate" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const generationId = (reserved.body.generation as { generation_id: string }).generation_id;
    const row = await env.DB.prepare(
      `SELECT job_id, stage_generation FROM pattern_generation_jobs WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ job_id: string; stage_generation: number }>();
    await executePatternJob(env, {
      kind: "pattern_generation",
      job_id: row!.job_id,
      generation_id: generationId,
      stage_generation: row!.stage_generation,
    }, new Date(), DETERMINISTIC_PATTERN_PUBLISHER);
    const afterPlan = await env.DB.prepare(
      `SELECT stage FROM pattern_generation_jobs WHERE generation_id = ?`,
    )
      .bind(generationId)
      .first<{ stage: string }>();
    expect(afterPlan?.stage).toBe("writing");
    await rotateUserDek(env, IDENTITY_A);
    const packet = await getArtifact(env, IDENTITY_A, generationId, "fact_packet");
    expect(packet).not.toBeNull();
    const plan = await getArtifact(env, IDENTITY_A, generationId, "validated_plan");
    expect(plan).toEqual(expect.objectContaining({ plan_hash: expect.any(String) }));
    expect(await drain(generationId)).toBe("succeeded");
  });

  it("retries Pattern erasure on birth replay after a failed chart-correction reconcile", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const reserved = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-birth-leftover" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(await drain((reserved.body.generation as { generation_id: string }).generation_id)).toBe(
      "succeeded",
    );
    await env.DB.prepare(
      `CREATE TRIGGER fail_pattern_correction_reconcile
       BEFORE DELETE ON pattern_documents
       BEGIN
         SELECT RAISE(ABORT, 'forced pattern reconcile failure');
       END`,
    ).run();
    try {
      const correction = await postBirthProfile(USER_A, "idem-pattern-birth-correction", {
        ...ALICE,
        birth_date: "1991-06-16",
      });
      expect(correction.status).toBe(503);
      expect((correction.body.error as { code: string }).code).toBe("pattern_invalidation_failed");
      const leftover = await env.DB.prepare(
        `SELECT id FROM pattern_documents WHERE user_id = ?`,
      )
        .bind(USER_A)
        .first<{ id: string }>();
      expect(leftover).not.toBeNull();
    } finally {
      await env.DB.prepare("DROP TRIGGER IF EXISTS fail_pattern_correction_reconcile").run();
    }

    const replay = await postBirthProfile(USER_A, "idem-pattern-birth-correction", {
      ...ALICE,
      birth_date: "1991-06-16",
    });
    expect(replay.status, JSON.stringify(replay.body)).toBe(202);
    expect(replay.body.status).toBe("duplicate");
    const gone = await env.DB.prepare(
      `SELECT id FROM pattern_documents WHERE user_id = ?`,
    )
      .bind(USER_A)
      .first<{ id: string }>();
    expect(gone).toBeNull();

    const exported = await assembleAccountExport(
      env,
      IDENTITY_A,
      "exp_pattern_leftover",
      new Date().toISOString(),
      { include_readings: false, include_journal: false, include_patterns: true },
    );
    const artifact = JSON.parse(new TextDecoder().decode(exported)) as {
      patterns: { status: string; items: Array<{ status: string }> };
    };
    expect(artifact.patterns.status).toBe("not_available");
    expect(artifact.patterns.items).toEqual([]);

    const erased = await json("/v1/pattern", {
      method: "DELETE",
      headers: { "idempotency-key": "idem-pattern-birth-leftover-delete" },
      body: JSON.stringify({ confirm: "DELETE PATTERN" }),
    });
    expect(erased.status).toBe(204);
  });
});


describe("M7 rollout, revocation, and export boundaries", () => {
  beforeEach(async () => {
    await resetDb();
    disablePatternAi();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
  });

  afterEach(() => {
    disablePatternAi();
    env.PATTERN_SEMANTIC_FORCE_REJECT = "";
    env.PATTERN_ONTOLOGY_KEYS = "";
  });

  it("moves an account holding an editorial Pattern into the generated flow", async () => {
    await seedActiveRelease();
    await seedActiveOntology();
    enablePatternAi();

    const state = await json("/v1/pattern-state");
    expect(state.body.state, JSON.stringify(state.body)).toBe("consent_required");
  });

  it("keeps GET /v1/pattern on the generated contract for an account with no claim", async () => {
    await seedActiveRelease();
    enablePatternAi();

    // The generated reader rejects every query parameter; the retired M4
    // catalogue accepted `limit`. The code proves which contract answered.
    const response = await json("/v1/pattern?limit=5");
    const code = (response.body.error as { code?: string } | undefined)?.code;
    expect(code, JSON.stringify(response.body)).toBe("invalid_pattern_query");
  });

  it("revokes a consent whose stored policy version has been superseded", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO consents (id, user_id, kind, status, permission_tier, allowed_uses_json,
         scopes_json, provider, policy_version, granted_at, version, created_at, updated_at)
       VALUES ('cns_old_policy', ?, 'pattern_generation', 'granted', 0, '[]', '[]', 'OpenAI',
         '0.9.0', ?, 1, ?, ?)`,
    )
      .bind(USER_A, now, now, now)
      .run();

    await revokePatternGenerationConsent(env, IDENTITY_A);

    const latest = await env.DB.prepare(
      `SELECT status, supersedes_consent_id FROM consents
       WHERE user_id = ? AND kind = 'pattern_generation'
       ORDER BY version DESC, created_at DESC, id DESC LIMIT 1`,
    )
      .bind(USER_A)
      .first<{ status: string; supersedes_consent_id: string | null }>();
    expect(latest?.status).toBe("revoked");
    expect(latest?.supersedes_consent_id).toBe("cns_old_policy");
  });

  it("erases every generation's key material when the reader deletes their Pattern", async () => {
    enablePatternAi();
    await seedActiveOntology();

    env.PATTERN_SEMANTIC_FORCE_REJECT = "1";
    const rejected = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-erase-first" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const failedId = (rejected.body.generation as { generation_id: string }).generation_id;
    expect(await drain(failedId)).toBe("failed");

    env.PATTERN_SEMANTIC_FORCE_REJECT = "";
    const accepted = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-erase-second" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "failed_attempt_retry",
      }),
    });
    const acceptedId = (accepted.body.generation as { generation_id: string }).generation_id;
    expect(await drain(acceptedId)).toBe("succeeded");

    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_generation_artifact_keys WHERE user_id = ? AND erased_at IS NULL`,
    )
      .bind(USER_A)
      .first<{ n: number }>();
    expect(before?.n).toBe(2);

    const deleted = await json("/v1/pattern", {
      method: "DELETE",
      headers: { "idempotency-key": "idem-pattern-erase-delete" },
      body: JSON.stringify({ confirm: "DELETE PATTERN" }),
    });
    expect(deleted.status).toBe(202);

    const after = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_generation_artifact_keys WHERE user_id = ? AND erased_at IS NULL`,
    )
      .bind(USER_A)
      .first<{ n: number }>();
    expect(after?.n, "the rejected generation's key survived the delete").toBe(0);
  });

  it("answers a terminal failure with pattern_generation_failed rather than not_generated", async () => {
    enablePatternAi();
    await seedActiveOntology();
    env.PATTERN_SEMANTIC_FORCE_REJECT = "1";
    const rejected = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-failed-read" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    const generationId = (rejected.body.generation as { generation_id: string }).generation_id;
    expect(await drain(generationId)).toBe("failed");

    const read = await json("/v1/pattern");
    expect(read.status, JSON.stringify(read.body)).toBe(409);
    const err = read.body.error as { code: string; details?: { retryable?: boolean } };
    expect(err.code).toBe("pattern_generation_failed");
    expect(err.details?.retryable).toBe(true);
  });

  it("lets a reader leave the generated Pattern out of their export", async () => {
    enablePatternAi();
    await seedActiveOntology();
    const accepted = await json("/v1/pattern-generations", {
      method: "POST",
      headers: { "idempotency-key": "idem-pattern-export-omit" },
      body: JSON.stringify({
        schema_version: "0.7.0",
        consent_policy_version: POLICY,
        confirm: "GENERATE MY PATTERN",
        reason: "first_open",
      }),
    });
    expect(await drain((accepted.body.generation as { generation_id: string }).generation_id)).toBe(
      "succeeded",
    );

    const parse = (bytes: Uint8Array) =>
      JSON.parse(new TextDecoder().decode(bytes)) as {
        patterns: { status: string; items: unknown[] };
      };

    const included = parse(
      await assembleAccountExport(env, IDENTITY_A, "exp_with_pattern", new Date().toISOString(), {
        include_readings: true,
        include_journal: true,
        include_patterns: true,
      }),
    );
    expect(included.patterns.status).toBe("included");
    expect(included.patterns.items).toHaveLength(1);

    const omitted = parse(
      await assembleAccountExport(env, IDENTITY_A, "exp_without_pattern", new Date().toISOString(), {
        include_readings: true,
        include_journal: true,
        include_patterns: false,
      }),
    );
    expect(omitted.patterns.status).toBe("omitted_by_request");
    expect(omitted.patterns.items).toEqual([]);
  });
});
