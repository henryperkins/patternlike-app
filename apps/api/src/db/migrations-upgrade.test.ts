import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { runPopulatedMigrationUpgrade } from "../../test/migration-upgrade.js";
import {
  buildDailyPublicationReceiptInsert,
  type DailyPublicationReceiptInput,
} from "./daily-publication-receipts.js";

/**
 * The populated forward-upgrade proof, run exactly once per suite invocation.
 *
 * This lane used to live in `test/apply-migrations.ts`, where Vitest executed
 * it as a setup file before every worker test file. It seeds a pre-0009
 * database with live rows, applies the migrations in slices to 0034, and
 * asserts byte-for-byte preservation at each rebuild. The assertions that
 * used to read its end state from `codex-provider-schema.test.ts` and
 * `daily-publication-receipts-schema.test.ts` live here now, next to the only
 * code that can create that state.
 */

const HEX64 = "0123456789abcdef".repeat(4);

async function insertUpgradeProviderJob(
  db: D1Database,
  seed: { id: string; pipeline: string; ownerId: string; userId: string | null; pass: string },
): Promise<void> {
  const discriminator = seed.id.slice("cpjob_".length);
  const row = {
    id: seed.id,
    pipeline: seed.pipeline,
    owner_id: seed.ownerId,
    user_id: seed.userId,
    pass: seed.pass,
    stage_generation: 1,
    stage_attempt: 0,
    request_hash: `sha256:${HEX64}`,
    request_object_key: `codex-provider-jobs/${seed.id}/request.json.enc`,
    request_envelope_hash: `sha256:${HEX64}`,
    request_ciphertext_hash: `sha256:${HEX64}`,
    request_key_id: `codex-key-${discriminator.slice(0, 8)}`,
    request_nonce: `nonce-${discriminator.slice(0, 16)}`,
    request_byte_length: 512,
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
    prompt_version: "1.0.1",
    timeout_ms: 900000,
    daily_call_limit: 10000,
    status: "pending",
    lease_token_hash: null,
    lease_expires_at: null,
    provider_request_id: null,
    input_tokens: null,
    output_tokens: null,
    failure_code: null,
    safe_detail_code: null,
    available_at: "2026-08-27T00:00:00.000Z",
    created_at: "2026-08-27T00:00:00.000Z",
    updated_at: "2026-08-27T00:00:00.000Z",
    completed_at: null,
    response_hash: null,
    response_object_key: null,
    response_envelope_hash: null,
    response_ciphertext_hash: null,
    response_key_id: null,
    response_nonce: null,
    response_byte_length: null,
  };
  const names = Object.keys(row);
  await db.prepare(
    `INSERT INTO codex_provider_jobs (${names.join(", ")})
     VALUES (${names.map(() => "?").join(", ")})`,
  ).bind(...Object.values(row)).run();
}

const receiptColumns = ["receipt_id", "reading_id", "job_id", "command_generation", "provider", "provider_job_id",
  "stage_generation", "stage_attempt", "model", "reasoning_effort", "prompt_version", "request_hash",
  "response_hash", "input_tokens", "output_tokens", "provider_completed_at", "worker_version_id", "release_git_sha", "published_at",
  "qualitative_findings_json"];

function receipt(effort: "high" | "xhigh"): DailyPublicationReceiptInput {
  return {
    readingId: `reading_${effort}`, jobId: `job_${effort}`, commandGeneration: 1,
    providerJobId: `cpjob_${"a".repeat(32)}`, stageGeneration: 1, stageAttempt: 0,
    model: "gpt-5.6-sol", reasoningEffort: effort, promptVersion: "1.0.3",
    requestHash: `sha256:${"a".repeat(64)}`, responseHash: `sha256:${"b".repeat(64)}`,
    inputTokens: 42, outputTokens: 10, providerCompletedAt: "2026-09-07T00:00:00Z",
    workerVersionId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", releaseGitSha: "a".repeat(40),
    qualitativeFindings: [],
  };
}

async function normalizedSchema(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations'
     ORDER BY type, name`,
  ).all<{ type: string; name: string; sql: string }>();
  return results.map(
    (row) => `${row.type} ${row.name} ${row.sql.replace(/\s+/g, " ").trim()}`,
  );
}

async function tableData(db: D1Database): Promise<Record<string, unknown[]>> {
  const { results } = await db.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*'
       AND name != 'd1_migrations'
     ORDER BY name`,
  ).all<{ name: string }>();
  const data: Record<string, unknown[]> = {};
  for (const { name } of results) {
    const rows = await db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    data[name] = rows.results;
  }
  return data;
}

describe("the test schema dump", () => {
  it("matches the schema and seed data produced by the real migration chain", async () => {
    await applyD1Migrations(env.SCHEMA_REFERENCE_DB, env.TEST_MIGRATIONS);
    expect(await normalizedSchema(env.DB)).toEqual(
      await normalizedSchema(env.SCHEMA_REFERENCE_DB),
    );
    // The chain seeds singleton rows on an empty database (today:
    // pattern_ontology_pointer); the dump must carry them too.
    expect(await tableData(env.DB)).toEqual(
      await tableData(env.SCHEMA_REFERENCE_DB),
    );
  }, 120_000);
});

describe("the populated migration upgrade", () => {
  it("carries live rows from before 0009 through 0034 without loss", async () => {
    await runPopulatedMigrationUpgrade();
    const upgradeDb = env.MIGRATION_UPGRADE_DB;

    // The populated 0017 upgrade: every seeded parent and child row survived
    // the rebuild byte-for-byte (snapshot taken by the lane before applying).
    const providerJobs = await upgradeDb.prepare(
      `SELECT id, pipeline, owner_id, user_id, pass, stage_generation,
              stage_attempt, request_hash, request_object_key,
              request_envelope_hash, request_ciphertext_hash, request_key_id,
              request_nonce, request_byte_length, response_hash,
              response_object_key, response_envelope_hash,
              response_ciphertext_hash, response_key_id, response_nonce,
              response_byte_length, model, reasoning_effort, prompt_version,
              timeout_ms, daily_call_limit, status, lease_token_hash,
              lease_expires_at, provider_request_id, input_tokens,
              output_tokens, failure_code, safe_detail_code, available_at,
              created_at, updated_at, completed_at
       FROM codex_provider_jobs ORDER BY id`,
    ).all();
    const jobsSnapshot = await upgradeDb.prepare(
      "SELECT payload FROM migration_upgrade_snapshot WHERE name = 'codex_provider_jobs'",
    ).first<{ payload: string }>();
    expect(jobsSnapshot).not.toBeNull();
    expect(providerJobs.results).toEqual(JSON.parse(jobsSnapshot!.payload));
    expect(new Set(providerJobs.results.map((row) => (row as { status: string }).status)))
      .toEqual(new Set(["pending", "leased", "completed", "failed", "cancelled"]));

    const providerUploads = await upgradeDb.prepare(
      `SELECT job_id, lease_token_hash, object_key, created_at
       FROM codex_provider_response_uploads ORDER BY job_id, lease_token_hash`,
    ).all();
    const uploadsSnapshot = await upgradeDb.prepare(
      `SELECT payload FROM migration_upgrade_snapshot
       WHERE name = 'codex_provider_response_uploads'`,
    ).first<{ payload: string }>();
    expect(uploadsSnapshot).not.toBeNull();
    expect(providerUploads.results).toEqual(JSON.parse(uploadsSnapshot!.payload));
    expect(providerUploads.results.length).toBe(2);

    // The widened 0017 coordinate is legal over the upgraded live rows.
    const newJobId = `cpjob_${"e".repeat(32)}`;
    await insertUpgradeProviderJob(upgradeDb, {
      id: newJobId,
      pipeline: "reading",
      ownerId: "job_upgrade_reading_0001",
      userId: "usr_99999999999999999999999999999999",
      pass: "publisher",
    });
    const newRow = await upgradeDb.prepare(
      "SELECT pipeline, pass FROM codex_provider_jobs WHERE id = ?",
    ).bind(newJobId).first();
    expect(newRow).toEqual({ pipeline: "reading", pass: "publisher" });
    await upgradeDb.prepare("DELETE FROM codex_provider_jobs WHERE id = ?")
      .bind(newJobId).run();

    const staging = await upgradeDb.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'codex_provider_%staging%'`,
    ).all();
    expect(staging.results).toEqual([]);
    const foreignKeys = await upgradeDb.prepare("PRAGMA foreign_key_check").all();
    expect(foreignKeys.results).toEqual([]);
    const quickCheck = await upgradeDb.prepare("PRAGMA quick_check")
      .first<{ quick_check: string }>();
    expect(quickCheck?.quick_check).toBe("ok");
    const probe = await upgradeDb.prepare("SELECT * FROM assertion_probe").all();
    expect(probe.results).toEqual([]);

    // 0029 on the populated 0028 upgrade: the receipts table has exactly the
    // technical allowlist, its two indexes, and no foreign keys.
    expect((await upgradeDb.prepare("PRAGMA table_info(daily_publication_receipts)").all<{ name: string }>()).results.map((row) => row.name)).toEqual(receiptColumns);
    expect(receiptColumns).not.toContain("user_id");
    expect((await upgradeDb.prepare("PRAGMA foreign_key_list(daily_publication_receipts)").all()).results).toEqual([]);
    expect((await upgradeDb.prepare("PRAGMA index_list(daily_publication_receipts)").all<{ name: string }>()).results
      .map((row) => row.name).filter((name) => !name.startsWith("sqlite_")).sort())
      .toEqual(["idx_daily_publication_receipts_job", "idx_daily_publication_receipts_release"]);
    for (const [name, fields] of [
      ["idx_daily_publication_receipts_job", ["job_id"]],
      ["idx_daily_publication_receipts_release", ["release_git_sha", "published_at", "receipt_id"]],
    ] as const) {
      expect((await upgradeDb.prepare(`PRAGMA index_info(${name})`).all<{ name: string }>()).results.map((row) => row.name)).toEqual(fields);
    }

    for (const effort of ["high", "xhigh"] as const) {
      await buildDailyPublicationReceiptInsert({ DB: upgradeDb }, receipt(effort), "2026-09-07T00:00:01Z").run();
    }
    for (const effort of ["low", "medium", "", "XHIGH"]) {
      await expect(buildDailyPublicationReceiptInsert({ DB: upgradeDb }, {
        ...receipt("high"), readingId: `invalid_${effort}`, reasoningEffort: effort as "high",
      }, "2026-09-07T00:00:01Z").run()).rejects.toThrow();
    }
    for (const id of ["aaaaaaaa-bbbbb-cccc-dddd-eeeeeeeeeee", "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1fZ"]) {
      await expect(buildDailyPublicationReceiptInsert({ DB: upgradeDb }, {
        ...receipt("high"), readingId: "invalid_uuid", workerVersionId: id,
      }, "2026-09-07T00:00:01Z").run()).rejects.toThrow();
    }
    expect((await upgradeDb.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect((await upgradeDb.prepare("PRAGMA quick_check").all()).results).toEqual([{ quick_check: "ok" }]);
    expect((await upgradeDb.prepare("SELECT * FROM assertion_probe").all()).results).toEqual([]);

    await buildDailyPublicationReceiptInsert({ DB: upgradeDb }, {
      ...receipt("high"), readingId: "reading_findings",
      qualitativeFindings: ["hype_vocabulary", "exclamation", "hype_vocabulary"],
    }, "2026-09-07T00:00:01Z").run();
    const findingsRow = await upgradeDb.prepare("SELECT qualitative_findings_json FROM daily_publication_receipts WHERE reading_id = ?")
      .bind("reading_findings").first<{ qualitative_findings_json: string }>();
    expect(JSON.parse(findingsRow!.qualitative_findings_json)).toEqual(["exclamation", "hype_vocabulary"]);
  }, 120_000);
});
