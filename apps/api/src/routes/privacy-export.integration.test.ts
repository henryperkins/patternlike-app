import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  SELF,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { CALC_CONTRACT_ID } from "@patternlike/shared";
import worker, { app } from "../index.js";
import type { Env, PrivacyMessage } from "../env.js";
import { encryptPayload } from "../db/users.js";
import {
  claimExportJob,
  failExportClaim,
  publishExport,
  releaseExportClaim,
} from "../db/privacy-jobs.js";
import { openExport, sealExport } from "../services/export-envelope.js";
import { processExportMessage } from "../services/privacy-jobs.js";
import { runPrivacyMaintenance } from "../services/privacy-maintenance.js";
import {
  IDENTITY_A,
  IDENTITY_B,
  USER_A,
  USER_B,
  resetDb,
  rows,
  seedChart,
  seedUser,
} from "../../test/helpers.js";

interface WorkflowAccepted {
  schema_version: "0.2.0";
  workflow: "ExportAccount";
  status: "queued" | "duplicate";
  idempotency_key: string;
  job_id: string;
  resource_id: string;
}

async function postExport(
  userId: string,
  key: string | null,
  body: unknown = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-user-id": userId,
  };
  if (key !== null) headers["idempotency-key"] = key;
  const response = await SELF.fetch("http://api.test/v1/exports", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return {
    response,
    body: (await response.json()) as WorkflowAccepted & {
      error?: { code: string; request_id: string };
    },
  };
}

async function deliver(jobId: string) {
  const batch = createMessageBatch<PrivacyMessage>(
    "patternlike-privacy-dev",
    [{
      id: `msg_${jobId}`,
      timestamp: new Date(),
      attempts: 1,
      body: {
        kind: "privacy",
        job_id: jobId,
        job_type: "export_account",
      },
    }],
  );
  const context = createExecutionContext();
  await worker.queue(batch, env);
  return getQueueResult(batch, context);
}

function fromB64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function seedReadingWithEvidence(): Promise<{
  readingId: string;
  paragraphId: string;
}> {
  const { fingerprint } = await seedChart(IDENTITY_A);
  const readingId = "rdg_export_fixture_0001";
  const paragraphId = "par_export_fixture_0001";
  const sourceId = "rsr_export_fixture_0001";
  const localDate = "2026-08-13";
  const createdAt = "2026-08-13T12:00:00.000Z";
  const hash = "b".repeat(64);
  const stored = {
    schema_version: "0.5.0" as const,
    reading: {
      schema_version: "0.5.0" as const,
      output_schema: "daily-reading-v5" as const,
      reading_id: readingId,
      local_date: localDate,
      generated_at: createdAt,
      assembly_mode: "constrained_model" as const,
      revision: 1,
      locale: "en-US",
      domain_preference: null,
      headline: "A smaller promise",
      disclosure: "Generated with OpenAI from your calculated chart and enabled context.",
      paragraphs: [{
        paragraph_id: paragraphId,
        role: "primary_theme",
        order: 1,
        text: "A smaller promise leaves room to respond to what changes.",
      }],
    },
    evidence_header: {
      schema_version: "0.5.0" as const,
      reading_id: readingId,
      revision: 1,
      revision_reason: "initial" as const,
      generated_at: createdAt,
      generation_input_id: `gin_sha256_${hash}`,
      input_manifest_hash: `sha256:${hash}`,
      content_hash: `sha256:${hash}`,
      provider_response_hash: `sha256:${hash}`,
      calculation: {
        chart_contract_id: CALC_CONTRACT_ID,
        cycle_policy_version: "1.4.0",
        daily_sky_policy_version: "1.0.0",
        ephemeris_data_version: "swisseph-2.10.03",
        container_digest: `sha256:${hash}`,
        tzdb_version: "2025b",
        local_day_resolution_policy_version: "1.0.0",
      },
      model: {
        provider: "openai" as const,
        model: "gpt-5.6-sol",
        prompt_version: "1.0.1",
        selection_policy_version: "1.0.0",
        validation_policy_version: "1.0.0",
        provider_request_id: "resp_export_fixture_0001",
        input_tokens: 200,
        output_tokens: 80,
      },
      validation: {
        status: "passed" as const,
        policy_version: "1.0.0",
        checks: [{ code: "grounding", passed: true as const }],
      },
    },
    invalidation: null,
  };
  const paragraphEvidence = {
    paragraph_id: paragraphId,
    role: "primary_theme",
    order: 1,
    fact_refs: [{
      fact_id: `cyc_${"a".repeat(32)}`,
      fact_class: "cycle_instance",
      label: "A measured transition",
      scope: "personalized",
    }],
    context_refs: [{
      private_ref: "ctx_1",
      category: "enabled_personal_context",
      allowed_use: "tone",
    }],
  };
  const sealedReading = await encryptPayload(env, IDENTITY_A, stored, {
    subject: IDENTITY_A.cryptoSubject,
    field: "daily_readings.reading_enc",
    recordId: readingId,
  });
  const sealedEvidence = await encryptPayload(env, IDENTITY_A, paragraphEvidence, {
    subject: IDENTITY_A.cryptoSubject,
    field: "reading_sources.evidence_enc",
    recordId: sourceId,
  });

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO daily_readings
         (id, user_id, local_date, release_version, reading_key, chart_fingerprint,
          contract_id, assembly_mode, status, revision, revision_reason,
          command_generation, reading_enc, reading_key_version, reading_nonce,
          created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 'constrained_model', 'published', 1,
               'initial', 1, ?, ?, ?, ?, ?)`,
    ).bind(
      readingId,
      USER_A,
      localDate,
      `reading-v5:${USER_A}:${localDate}:r1`,
      fingerprint,
      CALC_CONTRACT_ID,
      fromB64(sealedReading.ciphertext),
      sealedReading.keyVersion,
      sealedReading.nonce,
      createdAt,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO reading_sources
         (id, reading_id, user_id, paragraph_id, paragraph_order,
          evidence_enc, evidence_key_version, evidence_nonce, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    ).bind(
      sourceId,
      readingId,
      USER_A,
      paragraphId,
      fromB64(sealedEvidence.ciphertext),
      sealedEvidence.keyVersion,
      sealedEvidence.nonce,
      createdAt,
    ),
  ]);
  return { readingId, paragraphId };
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
  await seedUser(IDENTITY_B);
});

describe("account export", () => {
  it("reserves one encrypted job and distinguishes exact replay from conflict", async () => {
    const first = await postExport(USER_A, "idem-export-account-1");

    expect(first.response.status).toBe(202);
    expect(first.body).toMatchObject({
      schema_version: "0.2.0",
      workflow: "ExportAccount",
      status: "queued",
      idempotency_key: "idem-export-account-1",
    });
    expect(first.body.job_id).toMatch(/^job_/);
    expect(first.body.resource_id).toMatch(/^exp_/);

    const stored = await rows<{
      payload_json: string | null;
      payload_enc: ArrayBuffer | null;
      dispatched_at: string | null;
    }>("SELECT payload_json, payload_enc, dispatched_at FROM jobs WHERE id = ?", first.body.job_id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.payload_json).toBeNull();
    expect(stored[0]?.payload_enc).not.toBeNull();
    expect(stored[0]?.dispatched_at).toBeTruthy();

    const replay = await postExport(USER_A, "idem-export-account-1", {
      include_readings: true,
      include_journal: true,
    });
    expect(replay.response.status).toBe(202);
    expect(replay.body).toEqual({ ...first.body, status: "duplicate" });

    const conflict = await postExport(USER_A, "idem-export-account-1", {
      include_readings: false,
    });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body.error?.code).toBe("idempotency_conflict");

    // include_patterns is the M7 member of the frozen request. Omitting it from the
    // comparison replayed the first workflow and shipped the caller a patterns section
    // they asked to drop, so it has to conflict like any other changed member.
    const patternsConflict = await postExport(USER_A, "idem-export-account-1", {
      include_readings: true,
      include_journal: true,
      include_patterns: false,
    });
    expect(patternsConflict.response.status).toBe(409);
    expect(patternsConflict.body.error?.code).toBe("idempotency_conflict");
  });

  it("validates the frozen request without reserving work", async () => {
    const missing = await postExport(USER_A, null);
    expect(missing.response.status).toBe(400);
    expect(missing.body.error?.code).toBe("missing_idempotency_key");

    const invalid = await postExport(USER_A, "idem-export-invalid", {
      include_readings: "yes",
      extra: true,
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.error?.code).toBe("invalid_body");

    expect(await rows("SELECT id FROM export_requests")).toEqual([]);
    expect(await rows("SELECT id FROM jobs WHERE job_type = 'export_account'")).toEqual([]);
  });

  it("fails before reservation when object storage is not bound", async () => {
    const response = await app.request(
      "http://api.test/v1/exports",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": USER_A,
          "idempotency-key": "idem-export-no-storage",
        },
        body: "{}",
      },
      { ...env, ARTIFACTS: undefined } as typeof env,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "object_storage_not_configured" },
    });
    expect(await rows("SELECT id FROM export_requests")).toEqual([]);
  });

  it("checks secure configuration before a privacy message can claim work", async () => {
    const accepted = await postExport(USER_A, "idem-export-insecure-queue");
    const batch = createMessageBatch<PrivacyMessage>("patternlike-privacy-dev", [{
      id: "msg_insecure_privacy",
      timestamp: new Date(),
      attempts: 1,
      body: {
        kind: "privacy",
        job_id: accepted.body.job_id,
        job_type: "export_account",
      },
    }]);

    // Publisher bindings are intentionally optional while rollout is off.
    // An unknown rollout value is invalid in every environment and proves the
    // queue guard runs before a privacy claim without depending on that policy.
    await worker.queue(batch, { ...env, READING_V5_ROLLOUT: "of" });

    expect(
      await rows("SELECT status, attempts FROM jobs WHERE id = ?", accepted.body.job_id),
    ).toEqual([{ status: "queued", attempts: 0 }]);
    expect(await env.ARTIFACTS!.get(`exports/${accepted.body.resource_id}.json.enc`))
      .toBeNull();
  });

  it("publishes a sealed owner-scoped artifact and serves it only through the API", async () => {
    await seedChart(IDENTITY_A);
    const accepted = await postExport(USER_A, "idem-export-account-2", {
      include_readings: false,
      include_journal: true,
    });
    expect(accepted.response.status).toBe(202);

    const delivery = await deliver(accepted.body.job_id);
    expect(delivery.retryMessages).toEqual([]);

    const status = await SELF.fetch(
      `http://api.test/v1/exports/${accepted.body.resource_id}`,
      { headers: { "x-user-id": USER_A } },
    );
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as Record<string, unknown>;
    expect(statusBody).toMatchObject({
      schema_version: "0.6.0",
      export_request_id: accepted.body.resource_id,
      status: "ready",
      download_available: true,
      error_class: null,
    });
    expect(
      Date.parse(String(statusBody.expires_at)) -
        Date.parse(String(statusBody.completed_at)),
    ).toBe(7 * 24 * 60 * 60 * 1000);

    const objectKey = `exports/${accepted.body.resource_id}.json.enc`;
    const stored = await env.ARTIFACTS!.get(objectKey);
    expect(stored).not.toBeNull();
    expect(stored?.size).toBeGreaterThan(32);
    expect(await stored?.text()).not.toContain(USER_A);

    const envelopeRows = await rows<{
      created_at: string;
      wrapped_export_key: ArrayBuffer;
      export_key_nonce: string;
      export_kek_version: number;
      artifact_nonce: string;
    }>(
      `SELECT created_at, wrapped_export_key, export_key_nonce,
              export_kek_version, artifact_nonce
       FROM export_requests WHERE id = ?`,
      accepted.body.resource_id,
    );
    const envelope = envelopeRows[0]!;
    const storedAgain = await env.ARTIFACTS!.get(objectKey);
    await expect(
      openExport(env, accepted.body.resource_id, envelope.created_at, {
        ciphertext: await storedAgain!.arrayBuffer(),
        artifactNonce: envelope.artifact_nonce,
        wrappedExportKey: envelope.wrapped_export_key,
        exportKeyNonce: envelope.export_key_nonce,
        exportKekVersion: envelope.export_kek_version,
      }),
    ).resolves.toBeInstanceOf(Uint8Array);

    const foreign = await SELF.fetch(
      `http://api.test/v1/exports/${accepted.body.resource_id}`,
      { headers: { "x-user-id": USER_B } },
    );
    expect(foreign.status).toBe(404);

    const download = await SELF.fetch(
      `http://api.test/v1/exports/${accepted.body.resource_id}/download`,
      { headers: { "x-user-id": USER_A } },
    );
    const downloadText = await download.text();
    expect(download.status, downloadText).toBe(200);
    expect(download.headers.get("content-type")).toContain("application/json");
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(download.headers.get("cache-control")).toBe("no-store");
    const artifact = JSON.parse(downloadText) as Record<string, unknown>;
    expect(artifact).toMatchObject({
      schema_version: "0.7.0",
      export_id: accepted.body.resource_id,
      account: { user_id: USER_A, status: "active" },
      readings: { status: "omitted_by_request", items: [] },
      journal: { status: "not_available", items: [] },
      patterns: { status: "not_available", items: [] },
    });
    expect(artifact.birth_profiles).toHaveLength(1);
    expect(artifact.chart_snapshots).toHaveLength(1);
    expect(JSON.stringify(artifact)).not.toContain(IDENTITY_A.cryptoSubject);
  });

  it("includes saved readings and their decrypted evidence when requested", async () => {
    const { readingId, paragraphId } = await seedReadingWithEvidence();
    const accepted = await postExport(USER_A, "idem-export-with-evidence", {
      include_readings: true,
      include_journal: false,
    });
    await deliver(accepted.body.job_id);

    const download = await SELF.fetch(
      `http://api.test/v1/exports/${accepted.body.resource_id}/download`,
      { headers: { "x-user-id": USER_A } },
    );
    const body = await download.text();
    expect(download.status, body).toBe(200);
    const artifact = JSON.parse(body) as {
      readings: {
        status: string;
        items: Array<Record<string, unknown>>;
      };
    };
    expect(artifact.readings.status).toBe("included");
    expect(artifact.readings.items).toHaveLength(1);
    expect(artifact.readings.items[0]).toMatchObject({
      id: readingId,
      evidence: {
        schema_version: "0.5.0",
        paragraphs: [{ paragraph_id: paragraphId, order: 1 }],
      },
    });
    expect(JSON.stringify(artifact)).not.toContain("evidence_enc");
  });

  it("commits ready metadata and terminal job state atomically", async () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    const accepted = await postExport(USER_A, "idem-export-atomic-publish");
    const claim = await claimExportJob(env, accepted.body.job_id, now);
    if (!claim) throw new Error("export claim missing");
    const sealed = await sealExport(
      env,
      claim.exportId,
      claim.createdAt,
      new TextEncoder().encode("{}"),
    );
    await env.DB.prepare(
      `CREATE TRIGGER fail_export_job_completion
       BEFORE UPDATE OF status ON jobs
       WHEN NEW.status = 'succeeded' AND OLD.job_type = 'export_account'
       BEGIN
         SELECT RAISE(ABORT, 'forced export completion failure');
       END`,
    ).run();

    try {
      await expect(
        publishExport(
          env,
          claim,
          `r2://artifacts/exports/${claim.exportId}.json.enc`,
          sealed,
          now,
          new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        ),
      ).rejects.toThrow();
      expect(
        await rows(
          `SELECT status, r2_uri, wrapped_export_key
           FROM export_requests WHERE id = ?`,
          claim.exportId,
        ),
      ).toEqual([{
        status: "running",
        r2_uri: null,
        wrapped_export_key: null,
      }]);
      expect(
        await rows("SELECT status FROM jobs WHERE id = ?", claim.jobId),
      ).toEqual([{ status: "running" }]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_export_job_completion").run();
    }
  });

  it("does not let an expired claim fail its successor's export", async () => {
    const firstNow = new Date("2026-08-13T12:00:00.000Z");
    const accepted = await postExport(USER_A, "idem-export-stale-failure");
    const firstClaim = await claimExportJob(env, accepted.body.job_id, firstNow);
    if (!firstClaim) throw new Error("first export claim missing");
    const secondClaim = await claimExportJob(
      env,
      accepted.body.job_id,
      new Date(firstNow.getTime() + 6 * 60 * 1000),
    );
    if (!secondClaim) throw new Error("successor export claim missing");

    expect(
      await failExportClaim(env, firstClaim, "invariant_failed", firstNow),
    ).toBe(false);
    expect(
      await rows(
        `SELECT e.status AS export_status, j.status AS job_status,
                j.claim_token, j.attempts
         FROM export_requests e JOIN jobs j ON j.id = e.job_id
         WHERE e.id = ?`,
        firstClaim.exportId,
      ),
    ).toEqual([{
      export_status: "running",
      job_status: "running",
      claim_token: secondClaim.claimToken,
      attempts: 2,
    }]);

    expect(
      await failExportClaim(env, secondClaim, "invariant_failed", firstNow),
    ).toBe(true);
    expect(
      await rows(
        `SELECT e.status AS export_status, j.status AS job_status
         FROM export_requests e JOIN jobs j ON j.id = e.job_id
         WHERE e.id = ?`,
        firstClaim.exportId,
      ),
    ).toEqual([{ export_status: "failed", job_status: "failed" }]);
  });

  it("rolls back both sides when releasing an export claim fails", async () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    const accepted = await postExport(USER_A, "idem-export-atomic-release");
    const claim = await claimExportJob(env, accepted.body.job_id, now);
    if (!claim) throw new Error("export claim missing");
    await env.DB.prepare(
      `CREATE TRIGGER fail_export_request_release
       BEFORE UPDATE OF status ON export_requests
       WHEN NEW.status = 'queued' AND OLD.status = 'running'
       BEGIN
         SELECT RAISE(ABORT, 'forced export release failure');
       END`,
    ).run();

    try {
      await expect(
        releaseExportClaim(
          env,
          claim,
          new Date(now.getTime() + 60 * 1000),
        ),
      ).rejects.toThrow();
      expect(
        await rows(
          `SELECT e.status AS export_status, j.status AS job_status,
                  j.claim_token, j.available_at
           FROM export_requests e JOIN jobs j ON j.id = e.job_id
           WHERE e.id = ?`,
          claim.exportId,
        ),
      ).toEqual([{
        export_status: "running",
        job_status: "running",
        claim_token: claim.claimToken,
        available_at: null,
      }]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_export_request_release").run();
    }
  });

  it("keeps a successor artifact when an expired worker resumes its PUT", async () => {
    const firstNow = new Date();
    const accepted = await postExport(USER_A, "idem-export-r2-fence");
    const message: PrivacyMessage = {
      kind: "privacy",
      job_id: accepted.body.job_id,
      job_type: "export_account",
    };
    let successorRan = false;
    const originalPut = env.ARTIFACTS!.put.bind(env.ARTIFACTS!);
    const racingArtifacts = new Proxy(env.ARTIFACTS!, {
      get(target, property) {
        if (property === "put") {
          return async (...args: Parameters<typeof originalPut>) => {
            if (!successorRan) {
              successorRan = true;
              await expect(
                processExportMessage(
                  env,
                  message,
                  new Date(firstNow.getTime() + 6 * 60 * 1000),
                ),
              ).resolves.toBe("ack");
            }
            return originalPut(...args);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      processExportMessage(
        { ...env, ARTIFACTS: racingArtifacts } as Env,
        message,
        firstNow,
      ),
    ).resolves.toBe("ack");

    expect(successorRan).toBe(true);
    const objectKey = `exports/${accepted.body.resource_id}.json.enc`;
    const stored = await env.ARTIFACTS!.head(objectKey);
    expect(stored).not.toBeNull();
    expect(stored?.customMetadata?.publication_attempt).toBe("2");
    expect(
      await rows(
        `SELECT e.status AS export_status, j.status AS job_status, j.attempts
         FROM export_requests e JOIN jobs j ON j.id = e.job_id
         WHERE e.id = ?`,
        accepted.body.resource_id,
      ),
    ).toEqual([{
      export_status: "ready",
      job_status: "succeeded",
      attempts: 2,
    }]);
    const download = await SELF.fetch(
      `http://api.test/v1/exports/${accepted.body.resource_id}/download`,
      { headers: { "x-user-id": USER_A } },
    );
    expect(download.status, await download.text()).toBe(200);
  });

  it("redrives terminal artifact cleanup after an R2 delete failure", async () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    const accepted = await postExport(USER_A, "idem-export-terminal-cleanup");
    const objectKey = `exports/${accepted.body.resource_id}.json.enc`;
    await env.DB.prepare("UPDATE jobs SET attempts = 2 WHERE id = ?")
      .bind(accepted.body.job_id)
      .run();
    await env.ARTIFACTS!.put(objectKey, "stale encrypted export");
    const failingArtifacts = new Proxy(env.ARTIFACTS!, {
      get(target, property) {
        if (property === "head") {
          return async () => {
            throw new Error("forced terminal export write failure");
          };
        }
        if (property === "delete") {
          return async () => {
            throw new Error("forced terminal export cleanup failure");
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      processExportMessage(
        { ...env, ARTIFACTS: failingArtifacts } as Env,
        {
          kind: "privacy",
          job_id: accepted.body.job_id,
          job_type: "export_account",
        },
        now,
      ),
    ).rejects.toThrow("forced terminal export cleanup failure");
    expect(await env.ARTIFACTS!.head(objectKey)).not.toBeNull();
    expect(
      await rows(
        `SELECT status, artifact_deleted_at FROM export_requests WHERE id = ?`,
        accepted.body.resource_id,
      ),
    ).toEqual([{ status: "failed", artifact_deleted_at: null }]);

    await runPrivacyMaintenance(
      env,
      new Date(now.getTime() + 60 * 1000),
      { dispatchMessage: async () => true },
    );
    expect(await env.ARTIFACTS!.head(objectKey)).toBeNull();
    expect(
      await rows(
        `SELECT artifact_deleted_at FROM export_requests WHERE id = ?`,
        accepted.body.resource_id,
      ),
    ).toEqual([{ artifact_deleted_at: expect.any(String) }]);
  });

  it("allows frozen accounts to export", async () => {
    await env.DB.prepare("UPDATE users SET status = 'frozen' WHERE id = ?")
      .bind(USER_A)
      .run();

    const accepted = await postExport(USER_A, "idem-export-frozen-1");
    expect(accepted.response.status).toBe(202);
    await deliver(accepted.body.job_id);

    const download = await SELF.fetch(
      `http://api.test/v1/exports/${accepted.body.resource_id}/download`,
      { headers: { "x-user-id": USER_A } },
    );
    const downloadText = await download.text();
    expect(download.status, downloadText).toBe(200);
    expect(JSON.parse(downloadText)).toMatchObject({
      account: { status: "frozen" },
    });
  });

  it("projects elapsed artifacts as expired and refuses their download", async () => {
    const accepted = await postExport(USER_A, "idem-export-expired-1");
    await deliver(accepted.body.job_id);
    await env.DB.prepare(
      "UPDATE export_requests SET expires_at = ? WHERE id = ?",
    )
      .bind("2020-01-01T00:00:00.000Z", accepted.body.resource_id)
      .run();

    const status = await SELF.fetch(
      `http://api.test/v1/exports/${accepted.body.resource_id}`,
      { headers: { "x-user-id": USER_A } },
    );
    expect(await status.json()).toMatchObject({
      status: "expired",
      download_available: false,
    });
    expect(
      await env.ARTIFACTS!.get(`exports/${accepted.body.resource_id}.json.enc`),
    ).toBeNull();
    expect(
      await rows(
        `SELECT status, wrapped_export_key, artifact_nonce, r2_uri
         FROM export_requests WHERE id = ?`,
        accepted.body.resource_id,
      ),
    ).toEqual([{
      status: "expired",
      wrapped_export_key: null,
      artifact_nonce: null,
      r2_uri: null,
    }]);

    const download = await SELF.fetch(
      `http://api.test/v1/exports/${accepted.body.resource_id}/download`,
      { headers: { "x-user-id": USER_A } },
    );
    expect(download.status).toBe(410);
    expect(await download.json()).toMatchObject({
      error: { code: "export_expired" },
    });
  });
});
