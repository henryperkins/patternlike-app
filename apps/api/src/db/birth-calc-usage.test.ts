import { contentHash } from "@patternlike/shared";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  IDENTITY_A,
  IDENTITY_B,
  resetDb,
  rows,
  seedUser,
  USER_A,
  USER_B,
} from "../../test/helpers.js";
import {
  allocateBirthProfileVersion,
  prepareBirthCalcAttempt,
  readBirthCalcAttempt,
  type PreparedBirthCalcAttempt,
} from "./birth-calc-usage.js";

const NOW = new Date("2026-08-27T12:34:56.789Z");
const NOW_ISO = NOW.toISOString();
const RESET_AT = "2026-08-28T00:00:00.000Z";

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string;
}

async function tableInfo(table: string): Promise<TableInfoRow[]> {
  return rows<TableInfoRow>(`PRAGMA table_info(${table})`);
}

async function schemaSql(name: string): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT sql FROM sqlite_schema WHERE name = ?",
  ).bind(name).first<{ sql: string }>();
  if (!row) throw new Error(`missing schema object ${name}`);
  return row.sql.replace(/\s+/g, " ").trim();
}

async function prepare(
  userId: string,
  idempotencyKey: string,
  attempt: number,
  claimToken: string,
  limit = 5,
  now = NOW,
): Promise<PreparedBirthCalcAttempt> {
  return prepareBirthCalcAttempt(
    env,
    userId,
    idempotencyKey,
    attempt,
    claimToken,
    limit,
    now,
  );
}

async function commit(
  prepared: PreparedBirthCalcAttempt,
  extra: D1PreparedStatement[] = [],
): Promise<D1Result[]> {
  return env.DB.batch([...prepared.statements, ...extra]);
}

function guardedProfileInsert(
  prepared: PreparedBirthCalcAttempt,
  userId: string,
  version: number,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO birth_profiles (
       user_id, version, accuracy, status, created_at, updated_at
     )
     SELECT ?, ?, 'unknown', 'invalid', ?, ?
     WHERE EXISTS (
       SELECT 1 FROM birth_calc_reservations
       WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
         AND status = 'charged'
     )`,
  ).bind(
    userId,
    version,
    NOW_ISO,
    NOW_ISO,
    userId,
    prepared.reservationHash,
    prepared.claimTokenHash,
  );
}

function guardedJobInsert(
  prepared: PreparedBirthCalcAttempt,
  userId: string,
  jobId: string,
  idempotencyKey: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO jobs (
       id, job_type, user_id, idempotency_key, status, attempts, created_at
     )
     SELECT ?, 'NormalizeBirthAndCalculateChart', ?, ?, 'running', 1, ?
     WHERE EXISTS (
       SELECT 1 FROM birth_calc_reservations
       WHERE user_id = ? AND reservation_hash = ? AND claim_token_hash = ?
         AND status = 'charged'
     )`,
  ).bind(
    jobId,
    userId,
    idempotencyKey,
    NOW_ISO,
    userId,
    prepared.reservationHash,
    prepared.claimTokenHash,
  );
}

async function insertExistingProfile(userId: string, version: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO birth_profiles (
       user_id, version, accuracy, status, created_at, updated_at
     ) VALUES (?, ?, 'unknown', 'invalid', ?, ?)`,
  ).bind(userId, version, NOW_ISO, NOW_ISO).run();
}

async function seedHistoricalBudget(
  userId: string,
  utcDate: string,
  suffix: string,
): Promise<void> {
  const reservationHash = await contentHash(`historical-reservation-${suffix}`);
  const claimTokenHash = await contentHash(`historical-claim-${suffix}`);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO birth_calc_daily_usage (
         user_id, utc_date, reserved_calc_count, last_reservation_hash,
         created_at, updated_at
       ) VALUES (?, ?, 1, ?, ?, ?)`,
    ).bind(userId, utcDate, reservationHash, NOW_ISO, NOW_ISO),
    env.DB.prepare(
      `INSERT INTO birth_calc_reservations (
         user_id, reservation_hash, utc_date, claim_token_hash, status,
         created_at, charged_at
       ) VALUES (?, ?, ?, ?, 'denied', ?, NULL)`,
    ).bind(userId, reservationHash, utcDate, claimTokenHash, NOW_ISO),
  ]);
}

describe("birth calculation migration 0016", () => {
  beforeEach(resetDb);

  it("creates the three tables with exact columns and primary keys", async () => {
    expect(await tableInfo("birth_calc_daily_usage")).toEqual([
      { cid: 0, name: "user_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
      { cid: 1, name: "utc_date", type: "TEXT", notnull: 1, dflt_value: null, pk: 2 },
      {
        cid: 2,
        name: "reserved_calc_count",
        type: "INTEGER",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      },
      {
        cid: 3,
        name: "last_reservation_hash",
        type: "TEXT",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      },
      { cid: 4, name: "created_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      { cid: 5, name: "updated_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    ]);
    expect(await tableInfo("birth_calc_reservations")).toEqual([
      { cid: 0, name: "user_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
      {
        cid: 1,
        name: "reservation_hash",
        type: "TEXT",
        notnull: 1,
        dflt_value: null,
        pk: 2,
      },
      { cid: 2, name: "utc_date", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      {
        cid: 3,
        name: "claim_token_hash",
        type: "TEXT",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      },
      { cid: 4, name: "status", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      { cid: 5, name: "created_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      { cid: 6, name: "charged_at", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
    ]);
    expect(await tableInfo("birth_profile_version_counters")).toEqual([
      { cid: 0, name: "user_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
      {
        cid: 1,
        name: "last_allocated_version",
        type: "INTEGER",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      },
      { cid: 2, name: "updated_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    ]);
  });

  it("owns every table through the exact users foreign key", async () => {
    const expected: ForeignKeyRow[] = [{
      id: 0,
      seq: 0,
      table: "users",
      from: "user_id",
      to: "id",
      on_update: "NO ACTION",
      on_delete: "NO ACTION",
      match: "NONE",
    }];
    for (const table of [
      "birth_calc_daily_usage",
      "birth_calc_reservations",
      "birth_profile_version_counters",
    ]) {
      expect(await rows<ForeignKeyRow>(`PRAGMA foreign_key_list(${table})`))
        .toEqual(expected);
    }
  });

  it("installs the reservation lookup index with its exact key order", async () => {
    expect(await rows<IndexInfoRow>(
      "PRAGMA index_info(idx_birth_calc_reservations_user_date)",
    )).toEqual([
      { seqno: 0, cid: 0, name: "user_id" },
      { seqno: 1, cid: 2, name: "utc_date" },
    ]);
    expect(await schemaSql("idx_birth_calc_reservations_user_date")).toBe(
      "CREATE INDEX idx_birth_calc_reservations_user_date " +
      "ON birth_calc_reservations(user_id, utc_date)",
    );
  });

  it("retains the exact count, hash, status, and version checks", async () => {
    expect(await schemaSql("birth_calc_daily_usage")).toContain(
      "CHECK (reserved_calc_count BETWEEN 0 AND 50)",
    );
    expect(await schemaSql("birth_calc_daily_usage")).toContain(
      "CHECK (last_reservation_hash GLOB 'sha256:[0-9a-f]*' " +
      "AND length(last_reservation_hash) = 71)",
    );
    const reservationSql = await schemaSql("birth_calc_reservations");
    expect(reservationSql).toContain(
      "CHECK (reservation_hash GLOB 'sha256:[0-9a-f]*' " +
      "AND length(reservation_hash) = 71)",
    );
    expect(reservationSql).toContain(
      "CHECK (claim_token_hash GLOB 'sha256:[0-9a-f]*' " +
      "AND length(claim_token_hash) = 71)",
    );
    expect(reservationSql).toContain(
      "CHECK (status IN ('pending', 'charged', 'denied'))",
    );
    expect(reservationSql).toContain(
      "CHECK ( (status = 'pending' AND charged_at IS NULL) " +
      "OR (status = 'charged' AND charged_at IS NOT NULL) " +
      "OR (status = 'denied' AND charged_at IS NULL) )",
    );
    expect(await schemaSql("birth_profile_version_counters")).toContain(
      "CHECK (last_allocated_version >= 0)",
    );
  });

  it("rejects rows outside the declared checks and owner foreign keys", async () => {
    await seedUser(IDENTITY_A);
    const hash = await contentHash("migration-check");
    await expect(env.DB.prepare(
      `INSERT INTO birth_calc_daily_usage (
         user_id, utc_date, reserved_calc_count, last_reservation_hash,
         created_at, updated_at
       ) VALUES (?, '2026-08-27', 51, ?, ?, ?)`,
    ).bind(USER_A, hash, NOW_ISO, NOW_ISO).run()).rejects.toThrow();
    await expect(env.DB.prepare(
      `INSERT INTO birth_calc_reservations (
         user_id, reservation_hash, utc_date, claim_token_hash, status,
         created_at, charged_at
       ) VALUES (?, ?, '2026-08-27', ?, 'charged', ?, NULL)`,
    ).bind(USER_A, hash, hash, NOW_ISO).run()).rejects.toThrow();
    await expect(env.DB.prepare(
      `INSERT INTO birth_profile_version_counters (
         user_id, last_allocated_version, updated_at
       ) VALUES (?, -1, ?)`,
    ).bind(USER_A, NOW_ISO).run()).rejects.toThrow();
    await expect(env.DB.prepare(
      `INSERT INTO birth_profile_version_counters (
         user_id, last_allocated_version, updated_at
       ) VALUES ('usr_missing_birth_budget_owner', 1, ?)`,
    ).bind(NOW_ISO).run()).rejects.toThrow();
  });
});

describe("reservation-aware birth calculation budget", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await seedUser(IDENTITY_B);
  });

  it("charges a new reservation once and makes a same-hash replay free", async () => {
    const first = await prepare(USER_A, "birth-budget-replay-0001", 1, "claim-first");
    expect(first.statements).toHaveLength(6);
    await commit(first);
    expect(await readBirthCalcAttempt(
      env,
      USER_A,
      first.reservationHash,
      first.claimTokenHash,
      NOW,
    )).toEqual({
      status: "charged",
      winner: true,
      resetsAt: RESET_AT,
      retryAfterSeconds: 41_104,
    });

    const replay = await prepare(USER_A, "birth-budget-replay-0001", 1, "claim-replay");
    expect(replay.reservationHash).toBe(first.reservationHash);
    expect(replay.claimTokenHash).not.toBe(first.claimTokenHash);
    await commit(replay);
    expect(await readBirthCalcAttempt(
      env,
      USER_A,
      replay.reservationHash,
      replay.claimTokenHash,
      NOW,
    )).toEqual({
      status: "charged",
      winner: false,
      resetsAt: RESET_AT,
      retryAfterSeconds: 41_104,
    });
    expect(await rows<{ reserved_calc_count: number }>(
      `SELECT reserved_calc_count FROM birth_calc_daily_usage
       WHERE user_id = ? AND utc_date = '2026-08-27'`,
      USER_A,
    )).toEqual([{ reserved_calc_count: 1 }]);
    expect(await rows("SELECT reservation_hash FROM birth_calc_reservations"))
      .toHaveLength(1);
  });

  it("charges distinct hashes exactly through five and commits the sixth denied", async () => {
    for (let number = 1; number <= 6; number++) {
      const prepared = await prepare(
        USER_A,
        `birth-budget-distinct-${number}`,
        1,
        `claim-distinct-${number}`,
      );
      await commit(prepared);
      expect(await readBirthCalcAttempt(
        env,
        USER_A,
        prepared.reservationHash,
        prepared.claimTokenHash,
        NOW,
      )).toMatchObject({
        status: number <= 5 ? "charged" : "denied",
        winner: true,
      });
    }

    expect(await rows<{ reserved_calc_count: number }>(
      "SELECT reserved_calc_count FROM birth_calc_daily_usage WHERE user_id = ?",
      USER_A,
    )).toEqual([{ reserved_calc_count: 5 }]);
    expect(await rows<{ status: string; count: number }>(
      `SELECT status, COUNT(*) AS count FROM birth_calc_reservations
       WHERE user_id = ? GROUP BY status ORDER BY status`,
      USER_A,
    )).toEqual([
      { status: "charged", count: 5 },
      { status: "denied", count: 1 },
    ]);
  });

  it("commits denial while guarded profile and job statements remain no-ops", async () => {
    const charged = await prepare(USER_A, "birth-budget-first-0001", 1, "claim-first", 1);
    await commit(charged);

    const denied = await prepare(USER_A, "birth-budget-denied-0001", 1, "claim-denied", 1);
    await commit(denied, [
      guardedProfileInsert(denied, USER_A, 501),
      guardedJobInsert(denied, USER_A, "job_birth_budget_denied", "birth-budget-denied-0001"),
    ]);

    expect(await readBirthCalcAttempt(
      env,
      USER_A,
      denied.reservationHash,
      denied.claimTokenHash,
      NOW,
    )).toMatchObject({ status: "denied", winner: true });
    expect(await rows(
      "SELECT version FROM birth_profiles WHERE user_id = ? AND version = 501",
      USER_A,
    )).toEqual([]);
    expect(await rows(
      "SELECT id FROM jobs WHERE user_id = ? AND id = 'job_birth_budget_denied'",
      USER_A,
    )).toEqual([]);
  });

  it("converges concurrent same-coordinate callers on one charged claim and one guarded write", async () => {
    const first = await prepare(USER_A, "birth-budget-race-0001", 2, "claim-race-first");
    const second = await prepare(USER_A, "birth-budget-race-0001", 2, "claim-race-second");
    expect(second.reservationHash).toBe(first.reservationHash);

    await Promise.all([
      commit(first, [
        guardedProfileInsert(first, USER_A, 601),
        guardedJobInsert(first, USER_A, "job_birth_budget_race_first", "birth-budget-race-first"),
      ]),
      commit(second, [
        guardedProfileInsert(second, USER_A, 602),
        guardedJobInsert(second, USER_A, "job_birth_budget_race_second", "birth-budget-race-second"),
      ]),
    ]);

    const outcomes = await Promise.all([
      readBirthCalcAttempt(env, USER_A, first.reservationHash, first.claimTokenHash, NOW),
      readBirthCalcAttempt(env, USER_A, second.reservationHash, second.claimTokenHash, NOW),
    ]);
    expect(outcomes.map((outcome) => outcome?.status)).toEqual(["charged", "charged"]);
    expect(outcomes.filter((outcome) => outcome?.winner)).toHaveLength(1);
    expect(await rows("SELECT reservation_hash FROM birth_calc_reservations"))
      .toHaveLength(1);
    expect(await rows<{ reserved_calc_count: number }>(
      "SELECT reserved_calc_count FROM birth_calc_daily_usage WHERE user_id = ?",
      USER_A,
    )).toEqual([{ reserved_calc_count: 1 }]);
    expect(await rows<{ version: number }>(
      "SELECT version FROM birth_profiles WHERE user_id = ? ORDER BY version",
      USER_A,
    )).toHaveLength(1);
    expect(await rows<{ id: string }>(
      "SELECT id FROM jobs WHERE user_id = ? ORDER BY id",
      USER_A,
    )).toHaveLength(1);
  });

  it("rolls the reservation and charge back when an unrelated statement violates a constraint", async () => {
    const prepared = await prepare(
      USER_A,
      "birth-budget-rollback-0001",
      1,
      "claim-rollback",
    );
    await expect(commit(prepared, [
      env.DB.prepare(
        "UPDATE users SET status = 'not-a-user-status' WHERE id = ?",
      ).bind(USER_A),
    ])).rejects.toThrow();

    expect(await readBirthCalcAttempt(
      env,
      USER_A,
      prepared.reservationHash,
      prepared.claimTokenHash,
      NOW,
    )).toBeNull();
    expect(await rows("SELECT * FROM birth_calc_daily_usage")).toEqual([]);
    expect(await rows("SELECT * FROM birth_calc_reservations")).toEqual([]);
  });

  it("scopes identical reservation hashes and reads to the owning user", async () => {
    const first = await prepare(USER_A, "shared-birth-budget-key", 1, "claim-owner-a");
    const second = await prepare(USER_B, "shared-birth-budget-key", 1, "claim-owner-b");
    expect(second.reservationHash).toBe(first.reservationHash);
    await commit(first);

    expect(await readBirthCalcAttempt(
      env,
      USER_B,
      first.reservationHash,
      first.claimTokenHash,
      NOW,
    )).toBeNull();

    await commit(second);
    expect(await readBirthCalcAttempt(
      env,
      USER_B,
      second.reservationHash,
      second.claimTokenHash,
      NOW,
    )).toMatchObject({ status: "charged", winner: true });
    expect(await rows<{ user_id: string; reserved_calc_count: number }>(
      `SELECT user_id, reserved_calc_count FROM birth_calc_daily_usage
       ORDER BY user_id`,
    )).toEqual([
      { user_id: USER_A, reserved_calc_count: 1 },
      { user_id: USER_B, reserved_calc_count: 1 },
    ]);
  });

  it("allocates atomically from each owner's current maximum and remains monotonic", async () => {
    await insertExistingProfile(USER_A, 7);
    await insertExistingProfile(USER_B, 40);

    const [a, b, c, other] = await Promise.all([
      allocateBirthProfileVersion(env, USER_A, NOW),
      allocateBirthProfileVersion(env, USER_A, NOW),
      allocateBirthProfileVersion(env, USER_A, NOW),
      allocateBirthProfileVersion(env, USER_B, NOW),
    ]);
    expect([a, b, c].sort((left, right) => left - right)).toEqual([8, 9, 10]);
    expect(other).toBe(41);
    expect(await rows<{ user_id: string; last_allocated_version: number }>(
      `SELECT user_id, last_allocated_version
       FROM birth_profile_version_counters ORDER BY user_id`,
    )).toEqual([
      { user_id: USER_A, last_allocated_version: 10 },
      { user_id: USER_B, last_allocated_version: 41 },
    ]);
  });

  it("gives distinct idempotency coordinates distinct versions and permits denied gaps", async () => {
    const firstVersion = await allocateBirthProfileVersion(env, USER_A, NOW);
    const first = await prepare(USER_A, "birth-version-first-0001", 1, "claim-version-first", 1);
    await commit(first);

    const deniedVersion = await allocateBirthProfileVersion(env, USER_A, NOW);
    const denied = await prepare(
      USER_A,
      "birth-version-denied-0001",
      1,
      "claim-version-denied",
      1,
    );
    await commit(denied);
    const nextVersion = await allocateBirthProfileVersion(env, USER_A, NOW);

    expect([firstVersion, deniedVersion, nextVersion]).toEqual([1, 2, 3]);
    expect(first.reservationHash).not.toBe(denied.reservationHash);
    expect(await readBirthCalcAttempt(
      env,
      USER_A,
      denied.reservationHash,
      denied.claimTokenHash,
      NOW,
    )).toMatchObject({ status: "denied" });
    expect(await rows("SELECT version FROM birth_profiles WHERE user_id = ?", USER_A))
      .toEqual([]);
  });

  it("prunes only this owner's usage and reservations outside the 35-day UTC window", async () => {
    await allocateBirthProfileVersion(env, USER_A, NOW);
    await allocateBirthProfileVersion(env, USER_B, NOW);
    await seedHistoricalBudget(USER_A, "2026-07-23", "a-old");
    await seedHistoricalBudget(USER_A, "2026-07-24", "a-boundary");
    await seedHistoricalBudget(USER_B, "2026-07-23", "b-old");

    const current = await prepare(USER_A, "birth-prune-current-0001", 1, "claim-prune");
    await commit(current);

    expect(await rows<{ utc_date: string }>(
      `SELECT utc_date FROM birth_calc_daily_usage
       WHERE user_id = ? ORDER BY utc_date`,
      USER_A,
    )).toEqual([{ utc_date: "2026-07-24" }, { utc_date: "2026-08-27" }]);
    expect(await rows<{ utc_date: string }>(
      `SELECT utc_date FROM birth_calc_reservations
       WHERE user_id = ? ORDER BY utc_date`,
      USER_A,
    )).toEqual([{ utc_date: "2026-07-24" }, { utc_date: "2026-08-27" }]);
    expect(await rows<{ utc_date: string }>(
      "SELECT utc_date FROM birth_calc_daily_usage WHERE user_id = ?",
      USER_B,
    )).toEqual([{ utc_date: "2026-07-23" }]);
    expect(await rows<{ utc_date: string }>(
      "SELECT utc_date FROM birth_calc_reservations WHERE user_id = ?",
      USER_B,
    )).toEqual([{ utc_date: "2026-07-23" }]);
    expect(await rows<{ user_id: string }>(
      "SELECT user_id FROM birth_profile_version_counters ORDER BY user_id",
    )).toEqual([{ user_id: USER_A }, { user_id: USER_B }]);
  });

  it("keeps foreign keys, database integrity, and the assertion probe clean when populated", async () => {
    const prepared = await prepare(USER_A, "birth-budget-integrity-0001", 1, "claim-integrity");
    await commit(prepared);
    await allocateBirthProfileVersion(env, USER_A, NOW);

    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect(await env.DB.prepare("PRAGMA quick_check").first()).toEqual({
      quick_check: "ok",
    });
    expect(await rows("SELECT * FROM assertion_probe")).toEqual([]);
  });

  it("resetDb clears all three operational tables so later suites cannot inherit rows", async () => {
    const prepared = await prepare(USER_A, "birth-budget-reset-0001", 1, "claim-reset");
    await commit(prepared);
    await allocateBirthProfileVersion(env, USER_A, NOW);
    for (const table of [
      "birth_calc_reservations",
      "birth_calc_daily_usage",
      "birth_profile_version_counters",
    ]) {
      expect(await rows(`SELECT * FROM ${table}`)).toHaveLength(1);
    }

    await resetDb();
    for (const table of [
      "birth_calc_reservations",
      "birth_calc_daily_usage",
      "birth_profile_version_counters",
    ]) {
      expect(await rows(`SELECT * FROM ${table}`)).toEqual([]);
    }
  });
});
