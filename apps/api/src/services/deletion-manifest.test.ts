import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  IDENTITY_A,
  IDENTITY_B,
  resetDb,
  seedUser,
  USER_A,
  USER_B,
} from "../../test/helpers.js";
import {
  allocateBirthProfileVersion,
  prepareBirthCalcAttempt,
} from "../db/birth-calc-usage.js";

import {
  AUDIT_TABLE,
  DELETION_ARTIFACT_FAMILIES,
  DELETED_USER_TABLES,
  JOBS_TABLE,
  NON_PORTABLE_USER_TABLES,
  PORTABLE_USER_TABLES,
  RETAINED_USER_TABLES,
  collectDeletionArtifactKeys,
  deleteUserRows,
} from "./deletion-manifest.js";

async function schemaTables(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_schema
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'
     ORDER BY name`,
  ).all<{ name: string }>();
  return results.map((row) => row.name);
}

describe("account-deletion manifest", () => {
  beforeEach(resetDb);

  it("registers each user artifact family behind an internal safe prefix", () => {
    expect(DELETION_ARTIFACT_FAMILIES.map(({ family, prefix }) => ({ family, prefix })))
      .toEqual([
        { family: "pattern_portraits", prefix: "pattern-portraits/" },
        { family: "account_exports", prefix: "exports/" },
        { family: "pattern_generations", prefix: "pattern-generations/" },
        { family: "codex_provider_jobs", prefix: "codex-provider-jobs/" },
      ]);
    for (const { prefix } of DELETION_ARTIFACT_FAMILIES) {
      expect(prefix).toMatch(/^[a-z][a-z0-9-]*\/$/);
      expect(prefix).not.toContain("..");
    }
  });

  it("classifies every table with a direct user_id owner", async () => {
    const owned = new Set<string>();
    for (const table of await schemaTables()) {
      const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`)
        .all<{ name: string }>();
      if (results.some((column) => column.name === "user_id")) owned.add(table);
    }

    const classified = new Set<string>([
      ...DELETED_USER_TABLES,
      ...RETAINED_USER_TABLES,
      JOBS_TABLE,
    ]);
    expect(
      [...owned].filter((table) => !classified.has(table)),
      "A new directly user-owned table must be explicitly deleted or retained.",
    ).toEqual([]);
    expect(
      [...classified].filter((table) => table !== "users" && !owned.has(table)),
      "The deletion manifest names a table that is no longer directly user-owned.",
    ).toEqual([]);
  });

  it("classifies every table whose foreign keys point at users", async () => {
    const directChildren = new Set<string>();
    for (const table of await schemaTables()) {
      const { results } = await env.DB.prepare(`PRAGMA foreign_key_list(${table})`)
        .all<{ table: string }>();
      if (results.some((foreignKey) => foreignKey.table === "users")) {
        directChildren.add(table);
      }
    }
    const classified = new Set<string>([
      ...DELETED_USER_TABLES,
      ...RETAINED_USER_TABLES,
      JOBS_TABLE,
    ]);
    expect(
      [...directChildren].filter((table) => !classified.has(table)),
      "A new users foreign-key child must be classified for account deletion.",
    ).toEqual([]);
  });

  it("classifies every directly user-owned table as portable or non-portable", async () => {
    const owned = new Set<string>();
    for (const table of await schemaTables()) {
      const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`)
        .all<{ name: string }>();
      if (results.some((column) => column.name === "user_id" || column.name === "id" && table === "users")) {
        owned.add(table);
      }
    }
    owned.delete(JOBS_TABLE);
    owned.delete(AUDIT_TABLE);

    const portable = new Set<string>(PORTABLE_USER_TABLES);
    const nonPortable = new Set<string>(NON_PORTABLE_USER_TABLES);
    expect(
      [...owned].filter((table) => !portable.has(table) && !nonPortable.has(table)),
      "A new user-owned table must be explicitly portable or explicitly non-portable.",
    ).toEqual([]);
    expect(
      [...portable].filter((table) => nonPortable.has(table)),
      "A table cannot be both portable and non-portable.",
    ).toEqual([]);
    expect(
      [...portable, ...nonPortable].filter((table) => !owned.has(table)),
      "The portability manifest names a table that no longer exists.",
    ).toEqual([]);
  });

  it("keeps M7 generation operational state non-portable and the Pattern document portable", () => {
    expect(PORTABLE_USER_TABLES).toContain("pattern_documents");
    for (const table of [
      "pattern_generation_claims",
      "pattern_generation_jobs",
      "pattern_generation_artifact_keys",
      "pattern_generation_artifacts",
    ] as const) {
      expect(NON_PORTABLE_USER_TABLES).toContain(table);
      expect(PORTABLE_USER_TABLES).not.toContain(table as never);
      expect(DELETED_USER_TABLES).toContain(table);
    }
  });

  it("collects both encrypted Codex objects and deletes the provider row", async () => {
    await seedUser(IDENTITY_A);
    const jobId = `cpjob_${"ab".repeat(16)}`;
    const requestKey = `codex-provider-jobs/${jobId}/request.json.enc`;
    const responseKey = `codex-provider-jobs/${jobId}/response.json.enc`;
    const at = "2026-08-24T00:00:00.000Z";
    const hash = (byte: string) => `sha256:${byte.repeat(64)}`;
    await env.DB.prepare(
      `INSERT INTO codex_provider_jobs (
         id, pipeline, owner_id, user_id, pass, stage_generation, stage_attempt,
         request_hash, request_object_key, request_envelope_hash,
         request_ciphertext_hash, request_key_id, request_nonce,
         request_byte_length, response_hash, response_object_key,
         response_envelope_hash, response_ciphertext_hash, response_key_id,
         response_nonce, response_byte_length, model, reasoning_effort,
         prompt_version, timeout_ms, daily_call_limit, status,
         lease_token_hash, lease_expires_at, provider_request_id,
         input_tokens, output_tokens, available_at, created_at, updated_at,
         completed_at
       ) VALUES (
         ?, 'pattern', 'pgen_deletion_fixture', ?, 'planner', 0, 0,
         ?, ?, ?, ?, 'key', 'AAAAAAAAAAAAAAAA', 10,
         ?, ?, ?, ?, 'key', 'BBBBBBBBBBBBBBBB', 8,
         'gpt-5.6-sol', 'high', '1.0.0', 900000, 100, 'completed',
         ?, '2026-08-24T00:20:00.000Z', 'thread_deletion', 3, 2,
         ?, ?, ?, ?
       )`,
    ).bind(
      jobId,
      USER_A,
      hash("a"),
      requestKey,
      hash("b"),
      hash("c"),
      hash("d"),
      responseKey,
      hash("e"),
      hash("f"),
      hash("1"),
      at,
      at,
      at,
      at,
    ).run();
    const staleUploadKey =
      `codex-provider-jobs/${jobId}/responses/${"9".repeat(64)}.json.enc`;
    await env.DB.prepare(
      `INSERT INTO codex_provider_response_uploads (
         job_id, lease_token_hash, object_key, created_at
       ) VALUES (?, ?, ?, ?)`,
    ).bind(jobId, hash("9"), staleUploadKey, at).run();

    expect(await collectDeletionArtifactKeys(env, USER_A)).toEqual([
      requestKey,
      responseKey,
      staleUploadKey,
    ]);
    await deleteUserRows(env, USER_A, "job_deletion_fixture");
    expect(await env.DB.prepare(
      "SELECT id FROM codex_provider_jobs WHERE id = ?",
    ).bind(jobId).first()).toBeNull();
  });

  it("collects a reading exchange, its committed response, and a stale upload", async () => {
    // Daily provider work is user-owned for exactly this reason: the encrypted
    // request and every response object have to leave with the account. The
    // stale upload is the one a lease lost terminal CAS on -- it has no
    // pointer on the job row, so only the inventory table can find it.
    await seedUser(IDENTITY_A);
    const jobId = `cpjob_${"cd".repeat(16)}`;
    const requestKey = `codex-provider-jobs/${jobId}/request.json.enc`;
    const responseKey =
      `codex-provider-jobs/${jobId}/responses/${"1".repeat(64)}.json.enc`;
    const staleKey =
      `codex-provider-jobs/${jobId}/responses/${"2".repeat(64)}.json.enc`;
    const at = "2026-08-27T00:00:00.000Z";
    const hash = (byte: string) => `sha256:${byte.repeat(64)}`;
    await env.DB.prepare(
      `INSERT INTO codex_provider_jobs (
         id, pipeline, owner_id, user_id, pass, stage_generation, stage_attempt,
         request_hash, request_object_key, request_envelope_hash,
         request_ciphertext_hash, request_key_id, request_nonce,
         request_byte_length, response_hash, response_object_key,
         response_envelope_hash, response_ciphertext_hash, response_key_id,
         response_nonce, response_byte_length, model, reasoning_effort,
         prompt_version, timeout_ms, daily_call_limit, status,
         lease_token_hash, lease_expires_at, provider_request_id,
         input_tokens, output_tokens, available_at, created_at, updated_at,
         completed_at
       ) VALUES (
         ?, 'reading', 'job_reading_deletion_fixture', ?, 'publisher', 1, 0,
         ?, ?, ?, ?, 'key', 'AAAAAAAAAAAAAAAA', 10,
         ?, ?, ?, ?, 'key', 'BBBBBBBBBBBBBBBB', 8,
         'gpt-5.6-sol', 'high', '1.0.1', 900000, 250, 'completed',
         ?, '2026-08-27T00:20:00.000Z', 'thread_reading_deletion', 3, 2,
         ?, ?, ?, ?
       )`,
    ).bind(
      jobId,
      USER_A,
      hash("3"),
      requestKey,
      hash("4"),
      hash("5"),
      hash("6"),
      responseKey,
      hash("7"),
      hash("8"),
      hash("1"),
      at,
      at,
      at,
      at,
    ).run();
    await env.DB.prepare(
      `INSERT INTO codex_provider_response_uploads (
         job_id, lease_token_hash, object_key, created_at
       ) VALUES (?, ?, ?, ?)`,
    ).bind(jobId, hash("2"), staleKey, at).run();

    expect(await collectDeletionArtifactKeys(env, USER_A)).toEqual([
      requestKey,
      responseKey,
      staleKey,
    ]);
    await deleteUserRows(env, USER_A, "job_reading_deletion_fixture");
    expect(await env.DB.prepare(
      "SELECT id FROM codex_provider_jobs WHERE id = ?",
    ).bind(jobId).first()).toBeNull();
    // The cascade takes the inventory row with it, so nothing is left pointing
    // at an object the account no longer owns.
    expect(await env.DB.prepare(
      "SELECT job_id FROM codex_provider_response_uploads WHERE job_id = ?",
    ).bind(jobId).first()).toBeNull();
  });

  it("keeps the M4 derived caches non-portable and deleted with the account", () => {
    for (const table of ["natal_feature_sets", "cycle_scan_receipts", "time_travel_daily_usage"] as const) {
      expect(NON_PORTABLE_USER_TABLES).toContain(table);
      expect(PORTABLE_USER_TABLES).not.toContain(table as never);
      expect(DELETED_USER_TABLES).toContain(table);
    }
  });

  it("classifies every birth calculation guard table as deleted and non-portable", () => {
    for (const table of [
      "birth_calc_reservations",
      "birth_calc_daily_usage",
      "birth_profile_version_counters",
    ] as const) {
      expect(DELETED_USER_TABLES).toContain(table);
      expect(NON_PORTABLE_USER_TABLES).toContain(table);
      expect(PORTABLE_USER_TABLES).not.toContain(table as never);
    }
  });

  it("deletes one owner's birth calculation guard rows without touching another owner", async () => {
    await seedUser(IDENTITY_A);
    await seedUser(IDENTITY_B);
    const now = new Date("2026-08-27T12:00:00.000Z");
    const first = await prepareBirthCalcAttempt(
      env,
      USER_A,
      "birth-deletion-owner-a",
      1,
      "claim-deletion-owner-a",
      5,
      now,
    );
    const second = await prepareBirthCalcAttempt(
      env,
      USER_B,
      "birth-deletion-owner-b",
      1,
      "claim-deletion-owner-b",
      5,
      now,
    );
    await env.DB.batch(first.statements);
    await env.DB.batch(second.statements);
    await allocateBirthProfileVersion(env, USER_A, now);
    await allocateBirthProfileVersion(env, USER_B, now);

    await deleteUserRows(env, USER_A, "job_deletion_fixture");

    for (const table of [
      "birth_calc_reservations",
      "birth_calc_daily_usage",
      "birth_profile_version_counters",
    ]) {
      expect(await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`,
      ).bind(USER_A).first<{ count: number }>())
        .toEqual({ count: 0 });
      expect(await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`,
      ).bind(USER_B).first<{ count: number }>())
        .toEqual({ count: 1 });
    }
  });

  it("keeps payload-free audit proof in its explicit special class", async () => {
    expect(AUDIT_TABLE).toBe("audit_events");
    expect(DELETED_USER_TABLES).not.toContain(AUDIT_TABLE as never);
    expect(RETAINED_USER_TABLES).not.toContain(AUDIT_TABLE as never);
  });
});
