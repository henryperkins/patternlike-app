import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  IDENTITY_A,
  USER_A,
  resetDb,
  rows,
  seedUser,
} from "../../test/helpers.js";
import type { PrivacyMessage } from "../env.js";
import { exportObjectKey } from "./export-envelope.js";
import { runPrivacyMaintenance } from "./privacy-maintenance.js";

const NOW = new Date("2026-08-12T18:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

interface MaintenanceJob {
  id: string;
  jobType: string;
  idempotencyKey: string;
  status: string;
  finishedAt: string | null;
}

async function seedMaintenanceJobs(jobs: MaintenanceJob[]): Promise<void> {
  await env.DB.batch(
    jobs.map((job) =>
      env.DB.prepare(
        `INSERT INTO jobs
           (id, job_type, user_id, idempotency_key, status, attempts,
            finished_at, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(
        job.id,
        job.jobType,
        USER_A,
        job.idempotencyKey,
        job.status,
        job.finishedAt,
        job.finishedAt ?? NOW.toISOString(),
      )
    ),
  );
}

async function seedContextRows(): Promise<void> {
  const consentId = "cns_maintenance_0001";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO consents
         (id, user_id, kind, status, source_id, permission_tier,
          allowed_uses_json, scopes_json, policy_version, granted_at, version,
          created_at, updated_at)
       VALUES (?, ?, 'product_source', 'granted', 'USR-06', 1, '[]', '[]',
               '1.0.0', ?, 1, ?, ?)`,
    ).bind(consentId, USER_A, NOW.toISOString(), NOW.toISOString(), NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO context_source_permissions
         (user_id, source_id, enabled, permission_state, allowed_uses_json,
          permission_tier, consent_id, scopes_json, last_signal_id, updated_at)
       VALUES (?, 'USR-06', 1, 'active', '[]', 1, ?, '[]',
               'sig_retention_due', ?)`,
    ).bind(USER_A, consentId, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO context_signals
         (id, user_id, source_id, source_window, evidence_lane,
          allowed_uses_json, confidence, sensitivity, permission_state,
          conflict_status, consent_id, freshness_status, observed_at,
          ingested_at, expires_at, value_encoding, value_json, normalized_hash,
          source_revision, is_current, retention_expires_at, created_at, updated_at)
       VALUES ('sig_retention_due', ?, 'USR-06', '2025-07-01',
               'user_and_context', '[]', 'user_confirmed', 'sensitive',
               'active', 'none', ?, 'fresh', ?, ?, NULL, 'structured', '{}',
               'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               1, 1, '2026-08-12T17:59:59.000Z', ?, ?)`,
    ).bind(USER_A, consentId, NOW.toISOString(), NOW.toISOString(), NOW.toISOString(), NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO context_signals
         (id, user_id, source_id, source_window, evidence_lane,
          allowed_uses_json, confidence, sensitivity, permission_state,
          conflict_status, consent_id, freshness_status, observed_at,
          ingested_at, expires_at, value_encoding, value_json, normalized_hash,
          source_revision, is_current, retention_expires_at, created_at, updated_at)
       VALUES ('sig_eligibility_due', ?, 'USR-06', '2026-08-11',
               'user_and_context', '[]', 'user_confirmed', 'sensitive',
               'active', 'none', ?, 'fresh', ?, ?, '2026-08-12T17:59:59.000Z',
               'structured', '{}',
               'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
               1, 1, '2027-09-12T18:00:00.000Z', ?, ?)`,
    ).bind(USER_A, consentId, NOW.toISOString(), NOW.toISOString(), NOW.toISOString(), NOW.toISOString()),
  ]);
}

async function seedExpiredExport(): Promise<string> {
  const jobId = "job_export_ready_0001";
  const exportId = "exp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  await rows(
    `INSERT INTO jobs
       (id, job_type, user_id, idempotency_key, status, attempts, created_at,
        finished_at)
     VALUES (?, 'export_account', ?, 'idem-maintenance-ready', 'succeeded', 1, ?, ?)`,
    jobId,
    USER_A,
    NOW.toISOString(),
    NOW.toISOString(),
  );
  await rows(
    `INSERT INTO export_requests
       (id, user_id, status, r2_uri, expires_at, idempotency_key, created_at,
        completed_at, job_id, wrapped_export_key, export_key_nonce,
        export_kek_version, artifact_nonce, object_size_bytes, status_updated_at)
     VALUES (?, ?, 'ready', ?, '2026-08-12T17:59:59.000Z',
             'idem-maintenance-ready', ?, ?, ?, X'0102', 'key-nonce', 1,
             'artifact-nonce', 4, ?)`,
    exportId,
    USER_A,
    `r2://artifacts/${exportObjectKey(exportId)}`,
    NOW.toISOString(),
    NOW.toISOString(),
    jobId,
    NOW.toISOString(),
  );
  await env.ARTIFACTS!.put(exportObjectKey(exportId), new Uint8Array([1, 2, 3, 4]));
  return exportId;
}

async function seedRecoveryJobs(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO jobs
         (id, job_type, user_id, idempotency_key, status, attempts, created_at)
       VALUES ('job_export_undispatched', 'export_account', ?, 'idem-undispatched',
               'queued', 0, ?)`,
    ).bind(USER_A, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO jobs
         (id, job_type, user_id, idempotency_key, status, attempts, created_at,
          claim_token, lease_expires_at, dispatched_at)
       VALUES ('job_delete_expired_lease', 'delete_account', ?, 'idem-expired-lease',
               'running', 1, ?, 'clm_stale', '2026-08-12T17:00:00.000Z', ?)`,
    ).bind(USER_A, NOW.toISOString(), "2026-08-12T16:00:00.000Z"),
  ]);
}

async function seedExpiredDeletionReceipt(): Promise<void> {
  await rows(
    `INSERT INTO deletion_requests
       (id, user_id, status, dek_destroyed, idempotency_key, created_at,
        receipt_hash, receipt_expires_at, checkpoint, status_updated_at,
        completed_at)
     VALUES ('del_expired_receipt_0001', ?, 'completed', 1,
             'idem-expired-receipt', ?, ?, '2026-08-12T17:59:59.000Z',
             'completed', ?, ?)`,
    USER_A,
    NOW.toISOString(),
    "c".repeat(64),
    NOW.toISOString(),
    NOW.toISOString(),
  );
}

beforeEach(async () => {
  await resetDb();
  await seedUser(IDENTITY_A);
});

describe("privacy maintenance", () => {
  it("runs bounded expiry, retention, and recovery lanes", async () => {
    await seedContextRows();
    const exportId = await seedExpiredExport();
    await seedRecoveryJobs();
    await seedExpiredDeletionReceipt();
    const sent: PrivacyMessage[] = [];

    const summary = await runPrivacyMaintenance(env, NOW, {
      batchLimit: 10,
      dispatchMessage: async (_env, message) => {
        sent.push(message);
        return true;
      },
    });

    expect(summary).toEqual({
      signalsExpired: 1,
      signalsPurged: 1,
      exportsExpired: 1,
      failedExportArtifactsCleaned: 0,
      deletionArtifactsCleaned: 0,
      deletionReceiptsExpired: 1,
      devicePreferenceJobsPruned: 0,
      placeResolutionsPruned: 0,
      privacyJobsDispatched: 2,
    });
    expect(sent).toEqual([
      { kind: "privacy", job_id: "job_export_undispatched", job_type: "export_account" },
      { kind: "privacy", job_id: "job_delete_expired_lease", job_type: "delete_account" },
    ]);
    expect(await rows("SELECT id FROM context_signals WHERE id = 'sig_retention_due'"))
      .toEqual([]);
    expect(
      await rows("SELECT freshness_status FROM context_signals WHERE id = 'sig_eligibility_due'"),
    ).toEqual([{ freshness_status: "expired" }]);
    expect(
      await rows("SELECT last_signal_id FROM context_source_permissions WHERE user_id = ?", USER_A),
    ).toEqual([{ last_signal_id: null }]);
    expect(await env.ARTIFACTS!.get(exportObjectKey(exportId))).toBeNull();
    expect(
      await rows(
        `SELECT status, r2_uri, wrapped_export_key, artifact_nonce
         FROM export_requests WHERE id = ?`,
        exportId,
      ),
    ).toEqual([{
      status: "expired",
      r2_uri: null,
      wrapped_export_key: null,
      artifact_nonce: null,
    }]);
    expect(
      await rows(
        `SELECT id, dispatched_at FROM jobs
         WHERE id IN ('job_export_undispatched', 'job_delete_expired_lease')
         ORDER BY id`,
      ),
    ).toEqual([
      { id: "job_delete_expired_lease", dispatched_at: NOW.toISOString() },
      { id: "job_export_undispatched", dispatched_at: NOW.toISOString() },
    ]);
    expect(
      await rows(
        `SELECT receipt_hash, receipt_expires_at
         FROM deletion_requests WHERE id = 'del_expired_receipt_0001'`,
      ),
    ).toEqual([{ receipt_hash: null, receipt_expires_at: null }]);
  });

  it("exports the 35-day automatic preference job retention horizon", async () => {
    const module = await import("./privacy-maintenance.js");

    expect(Reflect.get(module, "DEVICE_PREFERENCE_JOB_RETENTION_DAYS")).toBe(35);
  });

  it("prunes only eligible succeeded automatic preference jobs", async () => {
    const cutoff = new Date(NOW.getTime() - 35 * DAY_MS);
    const old = new Date(cutoff.getTime() - 1).toISOString();
    const due = cutoff.toISOString();
    const recent = new Date(cutoff.getTime() + 1).toISOString();
    await seedMaintenanceJobs([
      {
        id: "job_device_zone_old",
        jobType: "preference_timezone",
        idempotencyKey: "web-device-timezone-old",
        status: "succeeded",
        finishedAt: old,
      },
      {
        id: "job_device_locale_due",
        jobType: "preference_locale",
        idempotencyKey: "web-device-locale-due",
        status: "succeeded",
        finishedAt: due,
      },
      {
        id: "job_device_zone_recent",
        jobType: "preference_timezone",
        idempotencyKey: "web-device-timezone-recent",
        status: "succeeded",
        finishedAt: recent,
      },
      {
        id: "job_device_locale_failed",
        jobType: "preference_locale",
        idempotencyKey: "web-device-locale-failed",
        status: "failed",
        finishedAt: old,
      },
      {
        id: "job_device_zone_queued",
        jobType: "preference_timezone",
        idempotencyKey: "web-device-timezone-queued",
        status: "queued",
        finishedAt: old,
      },
      {
        id: "job_manual_zone_old",
        jobType: "preference_timezone",
        idempotencyKey: "web-timezone-manual-old",
        status: "succeeded",
        finishedAt: old,
      },
      {
        id: "job_other_type_old",
        jobType: "export_account",
        idempotencyKey: "web-device-export-old",
        status: "succeeded",
        finishedAt: old,
      },
      {
        id: "job_device_locale_unfinished",
        jobType: "preference_locale",
        idempotencyKey: "web-device-locale-unfinished",
        status: "succeeded",
        finishedAt: null,
      },
    ]);

    const summary = await runPrivacyMaintenance(env, NOW, { batchLimit: 20 });

    expect(summary.devicePreferenceJobsPruned).toBe(2);
    expect(
      await rows<{ id: string }>(
        `SELECT id FROM jobs
         WHERE id LIKE 'job_%'
         ORDER BY id`,
      ),
    ).toEqual([
      { id: "job_device_locale_failed" },
      { id: "job_device_locale_unfinished" },
      { id: "job_device_zone_queued" },
      { id: "job_device_zone_recent" },
      { id: "job_manual_zone_old" },
      { id: "job_other_type_old" },
    ]);
  });

  it("prunes no more than the lane batch limit per run", async () => {
    const old = new Date(
      NOW.getTime() - (35 * DAY_MS) - 1,
    ).toISOString();
    await seedMaintenanceJobs(
      Array.from({ length: 4 }, (_, index) => ({
        id: `job_device_batch_${index}`,
        jobType: index % 2 === 0
          ? "preference_timezone"
          : "preference_locale",
        idempotencyKey: `web-device-batch-${index}`,
        status: "succeeded",
        finishedAt: old,
      })),
    );

    const summary = await runPrivacyMaintenance(env, NOW, { batchLimit: 2 });

    expect(summary.devicePreferenceJobsPruned).toBe(2);
    expect(
      await rows(
        "SELECT id FROM jobs WHERE id LIKE 'job_device_batch_%'",
      ),
    ).toHaveLength(2);
  });

  it("does not mark a privacy job dispatched when the queue send fails", async () => {
    await seedRecoveryJobs();
    const dispatchMessage = vi.fn(async () => false);

    const summary = await runPrivacyMaintenance(env, NOW, {
      batchLimit: 1,
      dispatchMessage,
    });

    expect(summary.privacyJobsDispatched).toBe(0);
    expect(dispatchMessage).toHaveBeenCalledOnce();
    expect(
      await rows("SELECT dispatched_at FROM jobs WHERE id = 'job_export_undispatched'"),
    ).toEqual([{ dispatched_at: null }]);
  });
});
