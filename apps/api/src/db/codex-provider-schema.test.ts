import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedUser, IDENTITY_A, USER_A } from "../../test/helpers.js";

/**
 * The D1 shape of the Codex provider control plane, proven directly.
 *
 * `0017` widens a closed vocabulary on a table that already holds live Pattern
 * and ontology work. Two things therefore have to be true at once: the new
 * `reading`/`publisher` coordinate must be legal, and every other combination
 * the widening makes *syntactically* expressible must still be refused. A
 * migration that widened `pipeline` and `pass` independently would admit
 * `reading`/`planner` and `ontology`/`publisher` as a side effect, and neither
 * has an owner, a budget ledger, or a current-owner check behind it.
 *
 * The populated-upgrade lane lives in `test/apply-migrations.ts`, which is the
 * only place that can seed rows *before* the migration runs. What this file
 * asserts about `MIGRATION_UPGRADE_DB` is the result of that lane.
 */

const HEX32 = "a".repeat(32);
const HEX64 = "0123456789abcdef".repeat(4);

interface ProviderJobSeed {
  id?: string;
  pipeline: string;
  ownerId: string;
  userId: string | null;
  pass: string;
  stageGeneration?: number;
  stageAttempt?: number;
}

function providerJobColumns(seed: ProviderJobSeed) {
  const id = seed.id ?? `cpjob_${HEX32}`;
  const discriminator = id.slice("cpjob_".length);
  return {
    id,
    pipeline: seed.pipeline,
    owner_id: seed.ownerId,
    user_id: seed.userId,
    pass: seed.pass,
    stage_generation: seed.stageGeneration ?? 1,
    stage_attempt: seed.stageAttempt ?? 0,
    request_hash: `sha256:${HEX64}`,
    request_object_key: `codex-provider-jobs/${id}/request.json.enc`,
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
    available_at: "2026-08-27T00:00:00.000Z",
    created_at: "2026-08-27T00:00:00.000Z",
    updated_at: "2026-08-27T00:00:00.000Z",
  };
}

async function insertProviderJob(
  db: D1Database,
  seed: ProviderJobSeed,
): Promise<void> {
  const row = providerJobColumns(seed);
  const names = Object.keys(row);
  await db.prepare(
    `INSERT INTO codex_provider_jobs (${names.join(", ")})
     VALUES (${names.map(() => "?").join(", ")})`,
  ).bind(...Object.values(row)).run();
}

describe("the codex_provider_jobs coordinate vocabulary", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  it("admits a reading publisher job owned by a user", async () => {
    await insertProviderJob(env.DB, {
      pipeline: "reading",
      ownerId: "job_reading_owner_0001",
      userId: USER_A,
      pass: "publisher",
    });

    const row = await env.DB.prepare(
      `SELECT pipeline, pass, user_id, stage_generation, stage_attempt
       FROM codex_provider_jobs WHERE id = ?`,
    ).bind(`cpjob_${HEX32}`).first();
    expect(row).toEqual({
      pipeline: "reading",
      pass: "publisher",
      user_id: USER_A,
      stage_generation: 1,
      stage_attempt: 0,
    });
  });

  it("still admits every pre-existing Pattern and ontology coordinate", async () => {
    const legal: Array<[string, string, string | null]> = [
      ["pattern", "planner", USER_A],
      ["pattern", "writer", USER_A],
      ["pattern", "verifier", USER_A],
      ["ontology", "planner", null],
      ["ontology", "writer", null],
      ["ontology", "verifier", null],
      ["ontology", "generator", null],
      ["ontology", "evaluator", null],
    ];
    for (const [index, [pipeline, pass, userId]] of legal.entries()) {
      await insertProviderJob(env.DB, {
        id: `cpjob_${index.toString(16).padStart(2, "0")}${"b".repeat(30)}`,
        pipeline,
        ownerId: `owner_${pipeline}_${pass}`,
        userId,
        pass,
      });
    }
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM codex_provider_jobs",
    ).first<{ count: number }>();
    expect(count?.count).toBe(legal.length);
  });

  it("refuses every pass the widened pipeline does not own", async () => {
    // Widening `pipeline` and `pass` independently would admit all of these.
    // Each one names work with no owner loader, no budget ledger, and no
    // current-owner check, so a row that reached the runner would be a
    // provider call nothing in the Worker could account for.
    const illegal: Array<[string, string, string | null]> = [
      ["reading", "planner", USER_A],
      ["reading", "writer", USER_A],
      ["reading", "verifier", USER_A],
      ["reading", "generator", USER_A],
      ["reading", "evaluator", USER_A],
      ["pattern", "publisher", USER_A],
      ["pattern", "generator", USER_A],
      ["pattern", "evaluator", USER_A],
      ["ontology", "publisher", null],
      ["editorial", "publisher", USER_A],
    ];
    for (const [index, [pipeline, pass, userId]] of illegal.entries()) {
      await expect(
        insertProviderJob(env.DB, {
          id: `cpjob_${index.toString(16).padStart(2, "0")}${"c".repeat(30)}`,
          pipeline,
          ownerId: `owner_${pipeline}_${pass}`,
          userId,
          pass,
        }),
      ).rejects.toThrow();
    }
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM codex_provider_jobs",
    ).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("requires a user on reading work and refuses one on ontology work", async () => {
    await expect(
      insertProviderJob(env.DB, {
        pipeline: "reading",
        ownerId: "job_reading_owner_0002",
        userId: null,
        pass: "publisher",
      }),
    ).rejects.toThrow();

    await expect(
      insertProviderJob(env.DB, {
        id: `cpjob_${"d".repeat(32)}`,
        pipeline: "ontology",
        ownerId: "oprun_owner_0001",
        userId: USER_A,
        pass: "generator",
      }),
    ).rejects.toThrow();
  });

  it("keeps every lifecycle, envelope, lease, and safe-failure constraint", async () => {
    const source = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'codex_provider_jobs'",
    ).first<{ sql: string }>();
    const normalized = source?.sql.replace(/\s+/g, " ") ?? "";
    for (const snippet of [
      "length(id) = 38 AND substr(id, 1, 6) = 'cpjob_'",
      "reasoning_effort = 'high'",
      "timeout_ms = 900000",
      "daily_call_limit > 0",
      "status IN ('pending', 'leased', 'completed', 'failed', 'cancelled')",
      "UNIQUE (pipeline, owner_id, pass, stage_generation, stage_attempt)",
      "UNIQUE (request_key_id, request_nonce)",
      "UNIQUE (response_key_id, response_nonce)",
      "substr(request_object_key, 1, 20) = 'codex-provider-jobs/'",
      "length(lease_token_hash) = 71",
      "unixepoch(updated_at) >= unixepoch(created_at)",
      "failure_code = 'publisher_budget_exhausted'",
      "safe_detail_code = 'daily_call_limit_reached'",
    ]) {
      expect(normalized).toContain(snippet);
    }
    // The widened relationships, byte for byte.
    expect(normalized).toContain(
      "CHECK (pipeline IN ('pattern', 'ontology', 'reading'))",
    );
    expect(normalized).toContain(
      "pass IN ( 'planner', 'writer', 'verifier', 'generator', 'evaluator', 'publisher' )",
    );
    expect(normalized).toContain("(pipeline = 'reading' AND pass = 'publisher')");
    expect(normalized).toContain(
      "(pipeline IN ('pattern', 'reading') AND user_id IS NOT NULL)",
    );
    expect(normalized).toContain(
      "(pipeline = 'ontology' AND user_id IS NULL)",
    );
    // No content column arrived with the widening. Request and response bodies
    // live only in create-only encrypted R2 envelopes.
    expect(normalized).not.toContain("prompt TEXT");
    expect(normalized).not.toContain("response_text");
  });

  it("keeps every index the claim, owner, user, and upload lanes need", async () => {
    const { results } = await env.DB.prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'index' AND tbl_name IN (
         'codex_provider_jobs', 'codex_provider_response_uploads'
       ) AND sql IS NOT NULL
       ORDER BY name`,
    ).all<{ name: string; sql: string }>();
    const byName = new Map(
      results.map((row) => [row.name, row.sql.replace(/\s+/g, " ")]),
    );
    expect([...byName.keys()]).toEqual([
      "idx_codex_provider_jobs_claimable",
      "idx_codex_provider_jobs_owner",
      "idx_codex_provider_jobs_user",
      "idx_codex_provider_response_uploads_created",
    ]);
    expect(byName.get("idx_codex_provider_jobs_claimable")).toContain(
      "(available_at, lease_expires_at, created_at, id) WHERE status IN ('pending', 'leased')",
    );
    expect(byName.get("idx_codex_provider_jobs_owner")).toContain(
      "( pipeline, owner_id, pass, stage_generation, stage_attempt )",
    );
    expect(byName.get("idx_codex_provider_jobs_user")).toContain(
      "(user_id, id) WHERE user_id IS NOT NULL",
    );
    expect(byName.get("idx_codex_provider_response_uploads_created")).toContain(
      "(created_at, job_id)",
    );
  });

  it("cascades response uploads when a reading provider job is deleted", async () => {
    const id = `cpjob_${HEX32}`;
    await insertProviderJob(env.DB, {
      pipeline: "reading",
      ownerId: "job_reading_owner_0003",
      userId: USER_A,
      pass: "publisher",
    });
    await env.DB.prepare(
      `INSERT INTO codex_provider_response_uploads (
         job_id, lease_token_hash, object_key, created_at
       ) VALUES (?, ?, ?, ?)`,
    ).bind(
      id,
      `sha256:${HEX64}`,
      `codex-provider-jobs/${id}/responses/${HEX64}.json.enc`,
      "2026-08-27T00:01:00.000Z",
    ).run();

    await env.DB.prepare("DELETE FROM codex_provider_jobs WHERE id = ?")
      .bind(id).run();
    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM codex_provider_response_uploads",
    ).first<{ count: number }>();
    expect(remaining?.count).toBe(0);
  });

  it("leaves the clean-apply database integral and unarmed", async () => {
    const foreignKeys = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(foreignKeys.results).toEqual([]);
    const quickCheck = await env.DB.prepare("PRAGMA quick_check")
      .first<{ quick_check: string }>();
    expect(quickCheck?.quick_check).toBe("ok");
    const probe = await env.DB.prepare("SELECT * FROM assertion_probe").all();
    expect(probe.results).toEqual([]);
  });
});

describe("the populated 0017 upgrade", () => {
  // Seeded and upgraded by test/apply-migrations.ts. Read-only here.
  const upgradeDb = env.MIGRATION_UPGRADE_DB;

  it("preserves every seeded parent row byte-for-byte", async () => {
    const { results } = await upgradeDb.prepare(
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
    const snapshot = await upgradeDb.prepare(
      "SELECT payload FROM migration_upgrade_snapshot WHERE name = 'codex_provider_jobs'",
    ).first<{ payload: string }>();
    expect(snapshot).not.toBeNull();
    expect(results).toEqual(JSON.parse(snapshot!.payload));
    // Every lifecycle the widening had to carry through the rebuild.
    expect(new Set(results.map((row) => (row as { status: string }).status)))
      .toEqual(new Set(["pending", "leased", "completed", "failed", "cancelled"]));
  });

  it("preserves every seeded response-upload child row byte-for-byte", async () => {
    const { results } = await upgradeDb.prepare(
      `SELECT job_id, lease_token_hash, object_key, created_at
       FROM codex_provider_response_uploads ORDER BY job_id, lease_token_hash`,
    ).all();
    const snapshot = await upgradeDb.prepare(
      `SELECT payload FROM migration_upgrade_snapshot
       WHERE name = 'codex_provider_response_uploads'`,
    ).first<{ payload: string }>();
    expect(snapshot).not.toBeNull();
    expect(results).toEqual(JSON.parse(snapshot!.payload));
    expect(results.length).toBe(2);
  });

  it("admits the new reading coordinate over live rows", async () => {
    const id = `cpjob_${"e".repeat(32)}`;
    await insertProviderJob(upgradeDb, {
      id,
      pipeline: "reading",
      ownerId: "job_upgrade_reading_0001",
      userId: "usr_99999999999999999999999999999999",
      pass: "publisher",
    });
    const row = await upgradeDb.prepare(
      "SELECT pipeline, pass FROM codex_provider_jobs WHERE id = ?",
    ).bind(id).first();
    expect(row).toEqual({ pipeline: "reading", pass: "publisher" });
    await upgradeDb.prepare("DELETE FROM codex_provider_jobs WHERE id = ?")
      .bind(id).run();
  });

  it("leaves no staging state, no violation, and no armed probe", async () => {
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
  });
});
