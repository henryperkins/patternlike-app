import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  SELF,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../index.js";
import type { PrivacyMessage } from "../env.js";
import {
  claimDeletionJob,
  releaseDeletionClaim,
  reserveAccountDeletion,
} from "../db/deletion-jobs.js";
import {
  canPublishExport,
  claimExportJob,
  reserveAccountExport,
} from "../db/privacy-jobs.js";
import { processDeletionMessage } from "../services/account-deletion.js";
import { exportObjectKey } from "../services/export-envelope.js";
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
  workflow: "DeleteAccount";
  status: "queued" | "duplicate";
  idempotency_key: string;
  job_id: string;
  resource_id: string;
}

async function requestDeletion(key: string, body: unknown = { confirm: "DELETE" }) {
  const response = await SELF.fetch("http://api.test/v1/account", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "x-user-id": USER_A,
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
  return {
    response,
    body: (await response.json()) as WorkflowAccepted & {
      error?: { code: string };
    },
  };
}

function receiptCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";", 1)[0] ?? "";
}

async function deliver(jobId: string) {
  const batch = createMessageBatch<PrivacyMessage>("patternlike-privacy-dev", [
    {
      id: `msg_${jobId}`,
      timestamp: new Date(),
      attempts: 1,
      body: {
        kind: "privacy",
        job_id: jobId,
        job_type: "delete_account",
      },
    },
  ]);
  const context = createExecutionContext();
  await worker.queue(batch, env);
  return getQueueResult(batch, context);
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
  await seedUser(IDENTITY_B);
});

describe("account deletion", () => {
  it("atomically locks the account and returns a narrowly scoped receipt", async () => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sessions
           (id, user_id, token_sha256, created_at, expires_at, last_seen_at)
         VALUES ('ses_delete_test', ?, ?, ?, ?, ?)`,
      ).bind(USER_A, "a".repeat(64), now, "2099-01-01T00:00:00.000Z", now),
      env.DB.prepare(
        `INSERT INTO context_source_permissions
           (user_id, source_id, enabled, permission_state, allowed_uses_json,
            permission_tier, scopes_json, updated_at)
         VALUES (?, 'USR-06', 1, 'active', '[]', 1, '[]', ?)`,
      ).bind(USER_A, now),
    ]);

    const accepted = await requestDeletion("idem-delete-account-1", {
      confirm: "DELETE",
      reason: "leaving",
    });

    expect(accepted.response.status).toBe(202);
    expect(accepted.body).toMatchObject({
      schema_version: "0.2.0",
      workflow: "DeleteAccount",
      status: "queued",
      idempotency_key: "idem-delete-account-1",
    });
    expect(accepted.body.job_id).toMatch(/^job_/);
    expect(accepted.body.resource_id).toMatch(/^del_/);
    const setCookie = accepted.response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("pl_deletion_receipt=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/v1/account/deletion-status");
    expect(setCookie).toContain("Max-Age=604800");

    expect(await rows("SELECT status FROM users WHERE id = ?", USER_A)).toEqual([
      { status: "pending_deletion" },
    ]);
    expect(await rows("SELECT revoked_at FROM sessions WHERE user_id = ?", USER_A))
      .toEqual([{ revoked_at: expect.any(String) }]);
    expect(
      await rows(
        `SELECT enabled, permission_state
         FROM context_source_permissions WHERE user_id = ?`,
        USER_A,
      ),
    ).toEqual([{ enabled: 0, permission_state: "revoked" }]);

    const job = await rows<{
      payload_json: string | null;
      payload_enc: unknown;
    }>("SELECT payload_json, payload_enc FROM jobs WHERE id = ?", accepted.body.job_id);
    expect(job[0]?.payload_json).toBeNull();
    expect(job[0]?.payload_enc).not.toBeNull();

    const status = await SELF.fetch("http://api.test/v1/account/deletion-status", {
      headers: { cookie: receiptCookie(accepted.response) },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      schema_version: "0.6.0",
      deletion_request_id: accepted.body.resource_id,
      status: "queued",
      completed_at: null,
      error_class: null,
    });
  });

  it("classifies exact replay and changed-body conflict without minting another receipt", async () => {
    const first = await requestDeletion("idem-delete-account-2");
    const replay = await reserveAccountDeletion(
      env,
      IDENTITY_A,
      "idem-delete-account-2",
      { confirm: "DELETE", reason: null },
    );

    expect(replay).toEqual({
      kind: "duplicate",
      response: { ...first.body, status: "queued" },
    });

    const conflict = await reserveAccountDeletion(
      env,
      IDENTITY_A,
      "idem-delete-account-2",
      { confirm: "DELETE", reason: "different" },
    );
    expect(conflict).toEqual({ kind: "conflict" });
    expect(await rows("SELECT id FROM deletion_requests")).toHaveLength(1);
  });

  it("requires a valid, unexpired receipt for status", async () => {
    const accepted = await requestDeletion("idem-delete-account-3");

    const missing = await SELF.fetch("http://api.test/v1/account/deletion-status");
    expect(missing.status).toBe(401);

    const invalid = await SELF.fetch("http://api.test/v1/account/deletion-status", {
      headers: { cookie: "pl_deletion_receipt=not-the-receipt" },
    });
    expect(invalid.status).toBe(401);

    await env.DB.prepare(
      "UPDATE deletion_requests SET receipt_expires_at = ? WHERE id = ?",
    )
      .bind("2020-01-01T00:00:00.000Z", accepted.body.resource_id)
      .run();
    const expired = await SELF.fetch("http://api.test/v1/account/deletion-status", {
      headers: { cookie: receiptCookie(accepted.response) },
    });
    expect(expired.status).toBe(401);
  });

  it("deletes the manifest, erases keys, retains only the tombstone and one proof", async () => {
    await seedChart(IDENTITY_A);
    const registeredExportId = `exp_${"a".repeat(32)}`;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO export_requests
         (id, user_id, status, idempotency_key, created_at, status_updated_at)
       VALUES (?, ?, 'queued', 'registered-before-delete', ?, ?)`,
    )
      .bind(registeredExportId, USER_A, now, now)
      .run();
    await env.ARTIFACTS!.put(
      `exports/${registeredExportId}.json.enc`,
      "orphaned encrypted export",
    );
    const accepted = await requestDeletion("idem-delete-account-4");
    const cookie = receiptCookie(accepted.response);

    const delivery = await deliver(accepted.body.job_id);
    expect(delivery.retryMessages).toEqual([]);

    const user = await rows<Record<string, unknown>>(
      `SELECT status, locale, timezone, entitlement_tier, next_due_at, deleted_at
       FROM users WHERE id = ?`,
      USER_A,
    );
    expect(user).toEqual([
      {
        status: "deleted",
        locale: "und",
        timezone: "UTC",
        entitlement_tier: "none",
        next_due_at: null,
        deleted_at: expect.any(String),
      },
    ]);
    expect(
      await rows(
        `SELECT wrapped_dek, destroyed_at, erased_at
         FROM user_keys WHERE user_id = ?`,
        USER_A,
      ),
    ).toEqual([
      {
        wrapped_dek: null,
        destroyed_at: expect.any(String),
        erased_at: expect.any(String),
      },
    ]);
    expect(await env.ARTIFACTS!.list({ prefix: "exports/" })).toMatchObject({
      objects: [],
    });

    for (const table of [
      "birth_profiles",
      "chart_snapshots",
      "sessions",
      "identities",
      "consents",
      "context_source_permissions",
      "context_signals",
      "jobs",
      "export_requests",
    ]) {
      expect(await rows(`SELECT * FROM ${table} WHERE user_id = ?`, USER_A), table)
        .toEqual([]);
    }
    expect(await rows("SELECT id FROM users WHERE id = ?", USER_B)).toHaveLength(1);
    expect(
      await rows(
        `SELECT action, resource_id, result
         FROM audit_events WHERE actor_id = ?`,
        USER_A,
      ),
    ).toEqual([
      {
        action: "account_deleted",
        resource_id: accepted.body.resource_id,
        result: "success",
      },
    ]);

    const status = await SELF.fetch("http://api.test/v1/account/deletion-status", {
      headers: { cookie },
    });
    expect(status.status).toBe(200);
    expect(status.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await status.json()).toMatchObject({ status: "completed" });

    await deliver(accepted.body.job_id);
    expect(
      await rows("SELECT id FROM audit_events WHERE action = 'account_deleted'"),
    ).toHaveLength(1);
  });

  it("removes a stale export PUT when deletion wins after the export claim", async () => {
    const exportNow = new Date("2026-08-12T18:00:00.000Z");
    const reserved = await reserveAccountExport(
      env,
      IDENTITY_A,
      "idem-export-delete-race",
      { include_readings: true, include_journal: true },
      exportNow,
    );
    if (reserved.kind !== "created") throw new Error("export reservation missing");
    const exportId = reserved.response.resource_id;
    let deletionId: string | null = null;
    let intercepted = false;
    const bucket = new Proxy(env.ARTIFACTS!, {
      get(target, property) {
        if (property === "put") {
          return async (...args: Parameters<R2Bucket["put"]>) => {
            if (!intercepted) {
              intercepted = true;
              const deletionNow = new Date(
                exportNow.getTime() + 6 * 60 * 1000,
              );
              const deletion = await reserveAccountDeletion(
                env,
                IDENTITY_A,
                "idem-delete-export-race",
                { confirm: "DELETE", reason: null },
                deletionNow,
              );
              if (deletion.kind !== "created") {
                throw new Error("deletion reservation missing");
              }
              deletionId = deletion.response.resource_id;
              expect(
                await processDeletionMessage(
                  env,
                  {
                    kind: "privacy",
                    job_id: deletion.response.job_id,
                    job_type: "delete_account",
                  },
                  deletionNow,
                ),
              ).toBe("ack");
            }
            return target.put(...args);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    expect(
      await processExportMessage(
        { ...env, ARTIFACTS: bucket },
        {
          kind: "privacy",
          job_id: reserved.response.job_id,
          job_type: "export_account",
        },
        exportNow,
      ),
    ).toBe("ack");

    expect(intercepted).toBe(true);
    expect(deletionId).toMatch(/^del_/);
    expect(await env.ARTIFACTS!.get(exportObjectKey(exportId))).toBeNull();
    expect(await rows("SELECT status FROM users WHERE id = ?", USER_A)).toEqual([
      { status: "deleted" },
    ]);
    expect(await rows("SELECT id FROM export_requests WHERE id = ?", exportId))
      .toEqual([]);
  });

  it("redrives a failed late-PUT cleanup from the retained deletion manifest", async () => {
    const exportNow = new Date("2026-08-12T18:00:00.000Z");
    const deletionNow = new Date(exportNow.getTime() + 6 * 60 * 1000);
    const reserved = await reserveAccountExport(
      env,
      IDENTITY_A,
      "idem-export-delete-cleanup-retry",
      { include_readings: true, include_journal: true },
      exportNow,
    );
    if (reserved.kind !== "created") throw new Error("export reservation missing");
    const objectKey = exportObjectKey(reserved.response.resource_id);
    let deletionId: string | null = null;
    let intercepted = false;
    let failLateDelete = false;
    const bucket = new Proxy(env.ARTIFACTS!, {
      get(target, property) {
        if (property === "put") {
          return async (...args: Parameters<R2Bucket["put"]>) => {
            if (!intercepted) {
              intercepted = true;
              const deletion = await reserveAccountDeletion(
                env,
                IDENTITY_A,
                "idem-delete-export-cleanup-retry",
                { confirm: "DELETE", reason: null },
                deletionNow,
              );
              if (deletion.kind !== "created") {
                throw new Error("deletion reservation missing");
              }
              deletionId = deletion.response.resource_id;
              expect(
                await processDeletionMessage(
                  env,
                  {
                    kind: "privacy",
                    job_id: deletion.response.job_id,
                    job_type: "delete_account",
                  },
                  deletionNow,
                ),
              ).toBe("ack");
              failLateDelete = true;
            }
            return target.put(...args);
          };
        }
        if (property === "delete") {
          return async (...args: Parameters<R2Bucket["delete"]>) => {
            if (failLateDelete) {
              failLateDelete = false;
              throw new Error("forced late export cleanup failure");
            }
            return target.delete(...args);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    expect(
      await processExportMessage(
        { ...env, ARTIFACTS: bucket },
        {
          kind: "privacy",
          job_id: reserved.response.job_id,
          job_type: "export_account",
        },
        exportNow,
      ),
    ).toBe("ack");
    expect(intercepted).toBe(true);
    expect(await env.ARTIFACTS!.head(objectKey)).not.toBeNull();
    const manifest = await rows<{ artifact_manifest_json: string }>(
      `SELECT artifact_manifest_json FROM deletion_requests WHERE id = ?`,
      deletionId,
    );
    expect(JSON.parse(manifest[0]!.artifact_manifest_json)).toContain(objectKey);

    await runPrivacyMaintenance(
      env,
      new Date(deletionNow.getTime() + 60 * 1000),
      { dispatchMessage: async () => true },
    );
    expect(await env.ARTIFACTS!.head(objectKey)).toBeNull();
    expect(
      await rows(
        `SELECT artifact_manifest_json, artifact_cleanup_until
         FROM deletion_requests WHERE id = ?`,
        deletionId,
      ),
    ).toEqual([{
      artifact_manifest_json: JSON.stringify([objectKey]),
      artifact_cleanup_until: new Date(
        deletionNow.getTime() + 8 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    }]);

    await runPrivacyMaintenance(
      env,
      new Date(deletionNow.getTime() + 9 * 24 * 60 * 60 * 1000),
      { dispatchMessage: async () => true },
    );
    expect(
      await rows(
        `SELECT artifact_manifest_json, artifact_cleanup_until
         FROM deletion_requests WHERE id = ?`,
        deletionId,
      ),
    ).toEqual([{
      artifact_manifest_json: "[]",
      artifact_cleanup_until: null,
    }]);
  });

  it("fails the export pre-PUT guard when deletion wins after its claim", async () => {
    const now = new Date("2026-08-12T18:00:00.000Z");
    const reserved = await reserveAccountExport(
      env,
      IDENTITY_A,
      "idem-export-pre-put-race",
      { include_readings: true, include_journal: true },
      now,
    );
    if (reserved.kind !== "created") throw new Error("export reservation missing");
    const claim = await claimExportJob(env, reserved.response.job_id, now);
    if (!claim) throw new Error("export claim missing");
    expect(await canPublishExport(env, claim)).toBe(true);

    const deletion = await reserveAccountDeletion(
      env,
      IDENTITY_A,
      "idem-delete-before-export-put",
      { confirm: "DELETE", reason: null },
      new Date(now.getTime() + 1_000),
    );
    expect(deletion.kind).toBe("created");
    expect(await canPublishExport(env, claim)).toBe(false);
  });

  it("backs transient deletion failures off exponentially within a hard bound", async () => {
    const acceptedAt = new Date("2026-08-12T18:00:00.000Z");
    const deletion = await reserveAccountDeletion(
      env,
      IDENTITY_A,
      "idem-delete-retry-backoff",
      { confirm: "DELETE", reason: null },
      acceptedAt,
    );
    if (deletion.kind !== "created") throw new Error("deletion reservation missing");
    const message = {
      kind: "privacy" as const,
      job_id: deletion.response.job_id,
      job_type: "delete_account" as const,
    };

    const first = await processDeletionMessage(
      { ...env, ARTIFACTS: undefined },
      message,
      acceptedAt,
    );
    expect(first).toEqual({ retryAfterSeconds: 60 });
    expect(
      await rows("SELECT available_at FROM jobs WHERE id = ?", message.job_id),
    ).toEqual([{ available_at: "2026-08-12T18:01:00.000Z" }]);

    const secondAt = new Date("2026-08-12T18:01:00.000Z");
    const second = await processDeletionMessage(
      { ...env, ARTIFACTS: undefined },
      message,
      secondAt,
    );
    expect(second).toEqual({ retryAfterSeconds: 120 });
    expect(
      await rows("SELECT available_at FROM jobs WHERE id = ?", message.job_id),
    ).toEqual([{ available_at: "2026-08-12T18:03:00.000Z" }]);
  });

  it("logs a safe failure event before retrying deletion work", async () => {
    const now = new Date("2026-08-12T18:00:00.000Z");
    const exportRequest = await reserveAccountExport(
      env,
      IDENTITY_A,
      "idem-export-delete-log",
      { include_readings: true, include_journal: true },
      now,
    );
    if (exportRequest.kind !== "created") throw new Error("export reservation missing");
    await env.ARTIFACTS!.put(
      exportObjectKey(exportRequest.response.resource_id),
      "encrypted export",
    );

    const deletion = await reserveAccountDeletion(
      env,
      IDENTITY_A,
      "idem-delete-log-failure",
      { confirm: "DELETE", reason: null },
      now,
    );
    if (deletion.kind !== "created") throw new Error("deletion reservation missing");

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failingBucket = new Proxy(env.ARTIFACTS!, {
      get(target, property) {
        if (property === "delete") {
          return async () => {
            throw new Error("forced deletion failure must stay out of logs");
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      processDeletionMessage(
        { ...env, ARTIFACTS: failingBucket },
        {
          kind: "privacy",
          job_id: deletion.response.job_id,
          job_type: "delete_account",
        },
        now,
      ),
    ).resolves.toEqual({ retryAfterSeconds: 60 });

    expect(error).toHaveBeenCalledWith(
      "deletion_processing_failed",
      expect.objectContaining({
        checkpoint: "exports_fenced",
        trace_id: expect.stringMatching(/^trc_[0-9a-f]{32}$/),
      }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("forced deletion failure");
  });

  it("rolls back both sides when releasing a deletion claim fails", async () => {
    const now = new Date("2026-08-12T18:00:00.000Z");
    const deletion = await reserveAccountDeletion(
      env,
      IDENTITY_A,
      "idem-delete-atomic-release",
      { confirm: "DELETE", reason: null },
      now,
    );
    if (deletion.kind !== "created") throw new Error("deletion reservation missing");
    const claim = await claimDeletionJob(env, deletion.response.job_id, now);
    if (!claim?.claimToken) throw new Error("deletion claim missing");
    await env.DB.prepare(
      `CREATE TRIGGER fail_deletion_request_release
       BEFORE UPDATE OF status ON deletion_requests
       WHEN NEW.status = 'queued' AND OLD.status = 'running'
       BEGIN
         SELECT RAISE(ABORT, 'forced deletion release failure');
       END`,
    ).run();

    try {
      await expect(
        releaseDeletionClaim(
          env,
          claim,
          new Date(now.getTime() + 60 * 1000),
        ),
      ).rejects.toThrow();
      expect(
        await rows(
          `SELECT d.status AS deletion_status, j.status AS job_status,
                  j.claim_token, j.available_at
           FROM deletion_requests d JOIN jobs j ON j.id = d.job_id
           WHERE d.id = ?`,
          claim.request.id,
        ),
      ).toEqual([{
        deletion_status: "running",
        job_status: "running",
        claim_token: claim.claimToken,
        available_at: null,
      }]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_deletion_request_release").run();
    }
  });

  it("cancels a queued export before deletion work begins", async () => {
    const reserved = await reserveAccountExport(
      env,
      IDENTITY_A,
      "idem-export-queued-delete",
      { include_readings: true, include_journal: true },
    );
    if (reserved.kind !== "created") throw new Error("export reservation missing");

    const deletion = await reserveAccountDeletion(
      env,
      IDENTITY_A,
      "idem-delete-queued-export",
      { confirm: "DELETE", reason: null },
    );
    if (deletion.kind !== "created") throw new Error("deletion reservation missing");

    expect(
      await rows("SELECT status, result_class FROM jobs WHERE id = ?", reserved.response.job_id),
    ).toEqual([{
      status: "cancelled",
      result_class: "account_pending_deletion",
    }]);
    expect(
      await processExportMessage(env, {
        kind: "privacy",
        job_id: reserved.response.job_id,
        job_type: "export_account",
      }),
    ).toBe("ack");
    expect(await env.ARTIFACTS!.get(exportObjectKey(reserved.response.resource_id)))
      .toBeNull();
  });
});
